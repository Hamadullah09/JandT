using Dapper;
using Npgsql;

namespace Warehouse.Api.Services;

/// <summary>
/// The movement ledger.
///
/// Every change to where a garment is or what state it is in goes through here
/// as well as updating the item row, and the two must happen in the same
/// transaction. The item row is the fast answer to "where is it now"; the
/// ledger is the answer to "where has it been", and it is the ledger that
/// settles an argument about a return.
///
/// Nothing in this class updates or deletes. If a movement was recorded wrongly
/// the correction is another movement, so that the mistake and the fix are both
/// on the record.
/// </summary>
public static class Ledger
{
    /// <summary>
    /// The item as it was before this movement. Named to match the column names
    /// so Dapper maps it without a manual projection — a ValueTuple here does
    /// not work, since Dapper maps by name and a tuple has none.
    /// </summary>
    private sealed record ItemState(int? room_id, string status);

    /// <summary>
    /// Moves an item and writes the ledger row for it.
    ///
    /// Pass null for a field to leave it as it is: most callers are changing
    /// either the room or the status, rarely both, and reading the current
    /// values first would be a second round trip for no gain.
    /// </summary>
    public static async Task RecordAsync(
        NpgsqlConnection conn,
        NpgsqlTransaction tx,
        int itemId,
        string type,
        int? toRoomId = null,
        string? toStatus = null,
        int? orderId = null,
        int? returnId = null,
        int? userId = null,
        string? note = null)
    {
        var before = await conn.QueryFirstOrDefaultAsync<ItemState>(
            "SELECT room_id, status FROM items WHERE id = @itemId FOR UPDATE",
            new { itemId }, tx)
            ?? throw ApiException.NotFound($"Item {itemId} no longer exists.");

        await conn.ExecuteAsync("""
            UPDATE items
               SET room_id      = COALESCE(@toRoomId, room_id),
                   status       = COALESCE(@toStatus, status),
                   last_seen_at = now()
             WHERE id = @itemId
            """,
            new { itemId, toRoomId, toStatus }, tx);

        await conn.ExecuteAsync("""
            INSERT INTO movements
                   (item_id, type, from_room_id, to_room_id, from_status, to_status,
                    order_id, return_id, user_id, note)
            VALUES (@itemId, @type, @fromRoomId, @toRoomId, @fromStatus, @toStatus,
                    @orderId, @returnId, @userId, @note)
            """,
            new
            {
                itemId,
                type,
                fromRoomId = before.room_id,
                toRoomId = toRoomId ?? before.room_id,
                fromStatus = before.status,
                toStatus = toStatus ?? before.status,
                orderId,
                returnId,
                userId,
                note,
            }, tx);
    }
}
