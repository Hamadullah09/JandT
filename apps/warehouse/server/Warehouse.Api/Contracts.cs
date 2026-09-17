namespace Warehouse.Api;

// Request bodies, in one file so the whole API surface can be read at once.
//
// They are records with nullable members rather than validated models: the
// checking happens in the endpoint next to the query that depends on it, where
// the message can say what the operator should do instead of naming a field.

public record LoginRequest(string Username, string Password);
public record ChangePasswordRequest(string CurrentPassword, string NewPassword);
public record CreateUserRequest(string Username, string Password, string FullName, string Role);

public record RoomRequest(string Code, string Name, string? Kind, int? Capacity, string? Notes);
public record RoomTagRequest(int RoomId, string Epc, string? Label);

public record LookupRequest(string Code, string Name, string? Hex, int? SortOrder);

public record ProductRequest(
    string? Sku,
    string Name,
    int CategoryId,
    string? Description,
    string? StockType,
    string? Supplier,
    decimal CostPrice,
    decimal SalePrice);

/// <summary>
/// Which variants a product should have.
///
/// Colours and sizes are sent as two lists and combined here rather than as a
/// list of pairs, because that is how the garment actually arrives: six colours
/// in five sizes is thirty variants, and nobody wants to tick thirty boxes.
/// Combinations that already exist are left alone, so this is also how you add
/// a colour to a product later.
/// </summary>
public record VariantGridRequest(int[] ColorIds, int[] SizeIds);

/// <summary>One colour and size of a new product, and how many of it arrived.</summary>
public record StockLineRequest(int ColorId, int SizeId, int Quantity);

/// <summary>
/// A new product together with what arrived of it.
///
/// One call rather than three - create the product, add its colours and
/// sizes, open an intake - because three calls can stop half way, and a
/// product that exists with no intake is exactly the "where do I put the
/// quantity" problem this replaces.
/// </summary>
/// <param name="Lines">
/// Every colour and size the product comes in. A quantity of 0 still creates
/// the colour and size; it just puts nothing on the intake.
/// </param>
/// <param name="RoomId">Where the tagged garments go. Null means the goods-in room.</param>
public record ProductWithStockRequest(
    string Name,
    int CategoryId,
    string? Description,
    string? StockType,
    string? Supplier,
    decimal CostPrice,
    decimal SalePrice,
    StockLineRequest[] Lines,
    int? RoomId);

public record VariantRequest(
    decimal? CostPrice,
    decimal? SalePrice,
    int? DropshipQty,
    int? ReorderLevel,
    int? Active);

/// <summary>
/// A garment that is not in the catalogue yet, typed on the intake form. The
/// colour and size are either chosen (an id) or typed (a name). A name already
/// in the catalogue is that product, so its category and prices are not needed.
/// </summary>
public record NewGarmentRequest(
    string Name,
    int? CategoryId,
    decimal? CostPrice,
    decimal? SalePrice,
    int? ColorId,
    string? ColorName,
    int? SizeId,
    string? SizeName);

/// <summary>One line of a delivery: a garment already in the catalogue, or a new one.</summary>
public record BatchLineRequest(int VariantId, int Quantity, decimal? UnitCost, NewGarmentRequest? NewGarment = null);
public record BatchRequest(string? Supplier, int? RoomId, string? Notes, BatchLineRequest[] Lines);

/// <summary>One tag, bound to one unit of one batch line. This is the handheld.</summary>
public record AssignTagRequest(string Epc, string? Tid, int BatchLineId, int? RoomId, string? Notes);

public record ItemUpdateRequest(int? RoomId, string? Status, string? Notes);
public record MoveItemsRequest(string[] Epcs, int RoomId, string? Note);

public record OrderLineRequest(int VariantId, int Quantity, decimal? UnitPrice);
public record OrderRequest(
    string CustomerName,
    string? CustomerPhone,
    string? CustomerEmail,
    string? Address,
    string? City,
    string? PostalCode,
    string? PaymentType,
    decimal? ShippingFee,
    decimal? Discount,
    string? Notes,
    OrderLineRequest[] Lines);

/// <summary>
/// One row of a sales spreadsheet.
///
/// The shape is the one the orders actually arrive in: a customer, an address,
/// a total and the name of a dress. No date and no order number, because
/// nothing outside this system issues either — the import mints both, which is
/// the whole reason for feeding the spreadsheet in rather than keeping it.
///
/// `VariantId` is how the preview screen answers the one question a row cannot:
/// which colour and size of that dress, when the name matches more than one.
/// </summary>
public record ImportOrderRow(
    string CustomerName,
    string? Phone,
    string? Address,
    string? City,
    string? PostalCode,
    decimal? Total,
    string? PaymentType,
    string? DressName,
    int? VariantId);

/// <summary>
/// A whole spreadsheet, and what to do about the dresses in it that the
/// catalogue has never heard of.
/// </summary>
public record ImportOrdersRequest(
    ImportOrderRow[] Rows,
    /// <summary>Null means now. One date for the batch; the file carries none.</summary>
    DateTime? PlacedAt,
    /// <summary>Create a product for a dress name that matches nothing.</summary>
    bool CreateMissing,
    /// <summary>Which category those new products go in.</summary>
    int? CategoryId,
    /// <summary>'dropship' or 'stock' for those new products.</summary>
    string? StockType);

/// <summary>
/// A tag being put on an order. `orderLineId` is optional: with it the operator
/// has said which line this is for, without it the server works it out from the
/// garment's variant, which is what the handheld does.
/// </summary>
public record PickRequest(string Epc, int? OrderLineId);

/// <param name="OrderId">
/// Which order is coming back. Optional when <paramref name="TrackingId"/> is
/// given: the counter has the customer's tracking number in front of it, not
/// our internal id.
/// </param>
public record ReturnRequest(int? OrderId, string? Reason, string? Notes, int? TrackingId);

/// <summary>
/// A garment coming back over the counter. The verdict is decided by the
/// server, never sent by the client — that check is the point of the screen.
/// </summary>
/// <param name="Reusability">
/// 1 no defects, 2 defective but usable, 3 defective beyond use. Null falls
/// back to <paramref name="Condition"/>, so a caller that only knows about
/// resellable and damaged still works.
/// </param>
public record ReturnScanRequest(string Epc, string? Condition, int? RestockRoomId, int? Reusability);

public record CloseReturnRequest(decimal? RefundAmount, int? RestockRoomId, string? Notes);

/// <summary>
/// Something to go on the radar. Either identifier will do: the office has the
/// SKU, the handheld needs the tag code, and whichever is given the other is
/// filled in from the register. Several can be pasted in at once.
/// </summary>
public record FindRequestBody(string? Epc, string? Search, string? Note);

public record FoundRequest(int? RoomId);

/// <summary>"Find me any one of these" - a colour and size, from the product search.</summary>
public record FindVariantRequest(string? Note);

/// <summary>Tags read in the returns room, to be told which of them are really returns.</summary>
public record ReturnCheckRequest(string[] Epcs);

/// <summary>One garment from the returns room, and the grade the operator gave it.</summary>
public record ReturnIntakeItem(string Epc, int? Reusability);

/// <summary>
/// Everything scanned in the returns room, added to inventory in one go.
/// </summary>
/// <param name="RoomId">The returns room. Null means the first active room of kind 'returns'.</param>
public record ReturnIntakeRequest(ReturnIntakeItem[] Items, int? RoomId);
