using Dapper;
using SkiaSharp;
using Warehouse.Api.Data;

namespace Warehouse.Api.Services;

/// <summary>
/// Keeps each product photo's numbers for search by photo.
///
/// A photo gets them the moment it is uploaded. Photos that were uploaded
/// before search by photo existed - or before the model file was put on the
/// server - get them when the server next starts, in the background, so the
/// dashboard is usable straight away and search by photo catches up.
/// </summary>
public static class PhotoIndex
{
    /// <summary>What reading a stored photo found.</summary>
    /// <param name="Readable">False when the file is not a picture at all.</param>
    /// <param name="Embedding">The numbers, or null when search by photo is off.</param>
    public readonly record struct Reading(bool Readable, byte[]? Embedding);

    public static Reading Read(PhotoStore store, PhotoMatcher matcher, string fileName)
    {
        var bytes = File.ReadAllBytes(store.PathOf(fileName));

        SKBitmap? picture;
        try
        {
            picture = PhotoMatcher.Decode(bytes);
        }
        catch (Exception ex) when (ex is DllNotFoundException or TypeInitializationException
                                       or BadImageFormatException or EntryPointNotFoundException)
        {
            // The picture library itself could not load on this server. That
            // is not the photo's fault, and uploads worked before it existed,
            // so the photo is kept - it just cannot be searched by.
            return new Reading(true, null);
        }

        if (picture is null) return new Reading(false, null);

        using (picture)
        {
            return new Reading(true, matcher.Available ? PhotoMatcher.ToBytes(matcher.Embed(picture)) : null);
        }
    }

    public static async Task CatchUpAsync(Db db, PhotoStore store, PhotoMatcher matcher, ILogger logger, CancellationToken stopping)
    {
        if (!matcher.Available) return;

        try
        {
            await using var conn = await db.OpenAsync();

            var waiting = (await conn.QueryAsync<(int Id, string FileName)>("""
                SELECT id, file_name FROM product_photos
                 WHERE embedding IS NULL OR embedding_model IS NULL OR embedding_model <> @model
                 ORDER BY id
                """, new { model = PhotoMatcher.ModelName })).ToList();

            if (waiting.Count == 0) return;
            logger.LogInformation("Search by photo: reading {Count} product photos", waiting.Count);

            int done = 0, skipped = 0;
            foreach (var (id, fileName) in waiting)
            {
                stopping.ThrowIfCancellationRequested();
                try
                {
                    if (!File.Exists(store.PathOf(fileName)))
                    {
                        skipped++;
                        logger.LogWarning("Search by photo: photo {Id} has no file ({File})", id, fileName);
                        continue;
                    }

                    var reading = Read(store, matcher, fileName);
                    if (reading.Embedding is null)
                    {
                        skipped++;
                        if (reading.Readable)
                            logger.LogWarning("Search by photo: photo {Id} ({File}) skipped - the picture library did not load", id, fileName);
                        else
                            logger.LogWarning("Search by photo: photo {Id} ({File}) could not be read as a picture", id, fileName);
                        continue;
                    }

                    // Keyed on the file as well as the id: a photo replaced
                    // while this ran must not be given the old picture's numbers.
                    await conn.ExecuteAsync("""
                        UPDATE product_photos SET embedding = @embedding, embedding_model = @model
                         WHERE id = @id AND file_name = @fileName
                        """, new { embedding = reading.Embedding, model = PhotoMatcher.ModelName, id, fileName });
                    done++;
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    skipped++;
                    logger.LogWarning(ex, "Search by photo: photo {Id} ({File}) failed", id, fileName);
                }
            }

            logger.LogInformation("Search by photo: {Done} photos ready, {Skipped} skipped", done, skipped);
        }
        catch (OperationCanceledException)
        {
            // The server is stopping; the rest are read next time.
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Search by photo: catching up on photos failed");
        }
    }
}
