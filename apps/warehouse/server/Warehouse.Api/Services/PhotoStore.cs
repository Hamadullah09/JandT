using System.Globalization;

namespace Warehouse.Api.Services;

/// <summary>
/// Where product photos are kept on disk.
///
/// Not under wwwroot. The dashboard builds straight into wwwroot with
/// emptyOutDir, so a photo saved there survives exactly until the next time
/// anybody rebuilds the dashboard - and nothing about that failure would say
/// what happened to it. They live in their own folder beside the application
/// instead, served at /uploads.
/// </summary>
public sealed class PhotoStore
{
    /// <summary>The largest photo accepted. A phone camera's JPEG is 3-6 MB.</summary>
    public const long MaxBytes = 10 * 1024 * 1024;

    /// <summary>How many photos one upload may carry.</summary>
    public const int MaxFilesPerUpload = 12;

    /// <summary>
    /// The largest upload request: every photo at its largest, and a megabyte
    /// for the form around them. The server's own default is about 28 MB -
    /// five phone photos - which would refuse an ordinary upload.
    /// </summary>
    public const long MaxUploadBytes = MaxFilesPerUpload * MaxBytes + 1024 * 1024;

    /// <summary>What the URL path under /uploads is for a product photo.</summary>
    public const string ProductFolder = "products";

    public string Root { get; }

    public PhotoStore(string root)
    {
        Root = root;
        Directory.CreateDirectory(Path.Combine(Root, ProductFolder));
    }

    public static string UrlFor(string fileName) => $"/uploads/{ProductFolder}/{fileName}";

    /// <summary>
    /// "10.4 MB", rounded up: 10.4 MB rounded down reads "10 MB" and then the
    /// refusal says a 10 MB photo is over a 10 MB limit.
    /// </summary>
    public static string Megabytes(long bytes) =>
        (Math.Ceiling(bytes / (1024.0 * 1024) * 10) / 10).ToString("0.#", CultureInfo.InvariantCulture) + " MB";

    /// <summary>
    /// Works out what an upload really is from its first bytes.
    ///
    /// The file name and the content type are both whatever the browser says,
    /// and a browser will cheerfully send a PDF named dress.jpg. The bytes do
    /// not lie, and they are also what decides whether a phone can draw it.
    /// Null means it is not a photo this system can show.
    /// </summary>
    public static string? ExtensionOf(ReadOnlySpan<byte> head)
    {
        if (head.Length >= 3 && head[0] == 0xFF && head[1] == 0xD8 && head[2] == 0xFF)
            return ".jpg";

        if (head.Length >= 8 && head[0] == 0x89 && head[1] == 0x50 && head[2] == 0x4E && head[3] == 0x47
            && head[4] == 0x0D && head[5] == 0x0A && head[6] == 0x1A && head[7] == 0x0A)
            return ".png";

        // RIFF....WEBP
        if (head.Length >= 12 && head[0] == 'R' && head[1] == 'I' && head[2] == 'F' && head[3] == 'F'
            && head[8] == 'W' && head[9] == 'E' && head[10] == 'B' && head[11] == 'P')
            return ".webp";

        return null;
    }

    /// <summary>
    /// Saves one upload and returns the file name it was saved under, or throws
    /// with a sentence the person uploading can act on.
    /// </summary>
    public async Task<string> SaveAsync(IFormFile file, CancellationToken ct = default)
    {
        if (file.Length == 0)
            throw ApiException.BadRequest($"{file.FileName} is empty.");
        if (file.Length > MaxBytes)
            throw ApiException.BadRequest(
                $"{file.FileName} is {Megabytes(file.Length)}. Photos can be up to {Megabytes(MaxBytes)}.");

        await using var input = file.OpenReadStream();

        var head = new byte[12];
        var read = 0;
        while (read < head.Length)
        {
            var n = await input.ReadAsync(head.AsMemory(read), ct);
            if (n == 0) break;
            read += n;
        }

        var extension = ExtensionOf(head.AsSpan(0, read))
            ?? throw ApiException.BadRequest(
                $"{file.FileName} is not a photo. Use a JPEG, PNG or WebP image.");

        // Random rather than derived from the upload's own name: two products
        // both photographed as IMG_0001.jpg must not overwrite each other, and a
        // name the uploader chose must never become part of a path on disk.
        var fileName = $"{Guid.NewGuid():N}{extension}";
        var path = Path.Combine(Root, ProductFolder, fileName);

        try
        {
            await using var output = File.Create(path);
            await output.WriteAsync(head.AsMemory(0, read), ct);
            await input.CopyToAsync(output, ct);
        }
        catch
        {
            // Half a photo - the upload dropped, or the disk filled - is not
            // recorded anywhere, so nothing would ever remove it.
            Delete(fileName);
            throw;
        }

        return fileName;
    }

    /// <summary>Where a stored photo is on disk. Only a bare name this class issued is accepted.</summary>
    public string PathOf(string fileName)
    {
        if (string.IsNullOrWhiteSpace(fileName) || fileName != Path.GetFileName(fileName))
            throw new ArgumentException("Not a stored photo's name.", nameof(fileName));
        return Path.Combine(Root, ProductFolder, fileName);
    }

    /// <summary>
    /// Removes a stored photo. A file that is already gone is not an error: the
    /// row is what the system believes, and it is being removed either way.
    /// </summary>
    public void Delete(string fileName)
    {
        // Only ever a bare name this class issued. Anything with a path in it
        // did not come from here and is not followed.
        if (fileName != Path.GetFileName(fileName)) return;

        var path = Path.Combine(Root, ProductFolder, fileName);
        try { if (File.Exists(path)) File.Delete(path); }
        catch (IOException) { /* locked by a viewer; the row is gone regardless */ }
    }
}
