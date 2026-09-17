using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;
using SkiaSharp;

namespace Warehouse.Api.Services;

/// <summary>
/// Recognises garments in photos, for search by photo.
///
/// Every product photo is turned into 384 numbers by DINOv2 - Meta's image
/// model, run on this server's own processor, so nothing is sent anywhere - and
/// a photo somebody searches with is turned into the same kind of numbers.
/// Photos of the same garment come out close together even when the pose, the
/// background, the light or the camera are different, so the search is simply
/// "which stored photos are closest to this one".
///
/// Measured on the shop's own pictures before this was written: a different
/// photo of the same outfit came first 5 times in 6 and in the top three every
/// time; a chat screenshot or a photo of a screen came first 9 times in 9. The
/// miss was the same design photographed in another colour, which still came
/// third - colour is weak evidence here by design, because the colours of a
/// product are its variants, not other products.
///
/// The model file is 84 MB and is not part of the code. Without it the rest of
/// the system works exactly as before and search by photo says it is not set up.
/// </summary>
public sealed class PhotoMatcher : IDisposable
{
    /// <summary>Stored beside every embedding, so a different model later re-reads the photos rather than comparing apples with pears.</summary>
    public const string ModelName = "dinov2-small";

    public const string ModelFile = "dinov2-small.onnx";

    private const int Side = 224;
    private static readonly float[] Mean = [0.485f, 0.456f, 0.406f];
    private static readonly float[] Std = [0.229f, 0.224f, 0.225f];

    /// <summary>
    /// The most pixels decoded for one picture. A phone photo is decoded at a
    /// reduced size anyway; this stops a small file of enormous dimensions - a
    /// flat 20000-pixel PNG - from taking the server's memory with it.
    /// </summary>
    private const long MaxDecodedPixels = 30_000_000;

    private readonly InferenceSession? _session;

    /// <summary>Why search by photo is unavailable, in words for the person trying to use it. Null when it works.</summary>
    public string? Problem { get; }

    public bool Available => _session is not null;

    public PhotoMatcher(IEnumerable<string?> candidatePaths, ILogger logger)
    {
        var path = candidatePaths.FirstOrDefault(p => !string.IsNullOrWhiteSpace(p) && File.Exists(p));
        if (path is null)
        {
            Problem = "Search by photo is not set up on this server: the recognition model " +
                      $"(models/{ModelFile}) is missing. See DEPLOY.md.";
            logger.LogWarning("Search by photo is off: {File} was not found", ModelFile);
            return;
        }

        try
        {
            _session = new InferenceSession(path);
            if (!_session.InputMetadata.ContainsKey("pixel_values") ||
                !_session.OutputMetadata.ContainsKey("last_hidden_state"))
            {
                throw new InvalidOperationException("the file is not the DINOv2 model this server expects");
            }
            logger.LogInformation("Search by photo is on ({Model}, {Path})", ModelName, path);
        }
        catch (Exception ex)
        {
            _session?.Dispose();
            _session = null;
            Problem = "Search by photo could not start on this server. The details are in the server log.";
            logger.LogError(ex, "Search by photo is off: the model at {Path} could not be loaded", path);
        }
    }

    public void Dispose() => _session?.Dispose();

    // ------------------------------------------------------------------ pictures

    /// <summary>
    /// A picture as pixels, turned the right way up and no larger than it needs
    /// to be, or null when the bytes are not a picture that can be read.
    /// </summary>
    public static SKBitmap? Decode(byte[] bytes, int maxSide = 1024)
    {
        using var data = SKData.CreateCopy(bytes);
        using var codec = SKCodec.Create(data);
        if (codec is null || codec.Info.Width <= 0 || codec.Info.Height <= 0) return null;

        // JPEG and WebP can decode straight to a smaller size, which for a
        // 12-megapixel phone photo is most of the work saved.
        var full = codec.Info.Size;
        var wanted = Math.Min(1f, (float)maxSide / Math.Max(full.Width, full.Height));
        var size = wanted < 1f ? codec.GetScaledDimensions(wanted) : full;

        var bitmap = TryDecode(codec, size);
        if (bitmap is null && size != full) bitmap = TryDecode(codec, full);
        if (bitmap is null) return null;

        if (Math.Max(bitmap.Width, bitmap.Height) > maxSide)
        {
            var scale = (float)maxSide / Math.Max(bitmap.Width, bitmap.Height);
            var smaller = Draw(bitmap, SKRect.Create(0, 0, bitmap.Width, bitmap.Height),
                Math.Max(1, (int)Math.Round(bitmap.Width * scale)), Math.Max(1, (int)Math.Round(bitmap.Height * scale)));
            bitmap.Dispose();
            bitmap = smaller;
        }

        return Orient(bitmap, codec.EncodedOrigin);
    }

    private static SKBitmap? TryDecode(SKCodec codec, SKSizeI size)
    {
        if ((long)size.Width * size.Height > MaxDecodedPixels)
            throw ApiException.BadRequest(
                $"That picture is {size.Width} x {size.Height} pixels, too large to read. Save it at a smaller size and try again.");

        var info = new SKImageInfo(size.Width, size.Height, SKColorType.Rgba8888, SKAlphaType.Premul);
        var bitmap = new SKBitmap(info);
        var result = codec.GetPixels(info, bitmap.GetPixels());

        // An image cut short still shows what arrived; a browser draws it the
        // same way, so it is not refused for that.
        if (result is SKCodecResult.Success or SKCodecResult.IncompleteInput) return bitmap;

        bitmap.Dispose();
        return null;
    }

    /// <summary>
    /// Phones store a portrait photo sideways and note which way up it goes. A
    /// garment lying on its side is a different picture to the model, so the
    /// note is applied before anything else looks at it.
    /// </summary>
    private static SKBitmap Orient(SKBitmap src, SKEncodedOrigin origin)
    {
        if (origin == SKEncodedOrigin.TopLeft) return src;

        float w = src.Width, h = src.Height;
        var sideways = origin is SKEncodedOrigin.LeftTop or SKEncodedOrigin.RightTop
            or SKEncodedOrigin.RightBottom or SKEncodedOrigin.LeftBottom;
        var (outW, outH) = sideways ? (h, w) : (w, h);

        // Where each source pixel (x, y) lands: x' = ScaleX*x + SkewX*y + TransX,
        // y' = SkewY*x + ScaleY*y + TransY.
        var m = origin switch
        {
            SKEncodedOrigin.TopRight => new SKMatrix { ScaleX = -1, TransX = outW, ScaleY = 1, Persp2 = 1 },
            SKEncodedOrigin.BottomRight => new SKMatrix { ScaleX = -1, TransX = outW, ScaleY = -1, TransY = outH, Persp2 = 1 },
            SKEncodedOrigin.BottomLeft => new SKMatrix { ScaleX = 1, ScaleY = -1, TransY = outH, Persp2 = 1 },
            SKEncodedOrigin.LeftTop => new SKMatrix { SkewX = 1, SkewY = 1, Persp2 = 1 },
            SKEncodedOrigin.RightTop => new SKMatrix { SkewX = -1, TransX = outW, SkewY = 1, Persp2 = 1 },
            SKEncodedOrigin.RightBottom => new SKMatrix { SkewX = -1, TransX = outW, SkewY = -1, TransY = outH, Persp2 = 1 },
            SKEncodedOrigin.LeftBottom => new SKMatrix { SkewX = 1, SkewY = -1, TransY = outH, Persp2 = 1 },
            _ => SKMatrix.Identity,
        };

        var dst = new SKBitmap(new SKImageInfo((int)outW, (int)outH, SKColorType.Rgba8888, SKAlphaType.Premul));
        using (var canvas = new SKCanvas(dst))
        using (var image = SKImage.FromBitmap(src))
        {
            canvas.SetMatrix(m);
            canvas.DrawImage(image, 0, 0, new SKSamplingOptions(SKFilterMode.Nearest));
        }
        src.Dispose();
        return dst;
    }

    /// <summary>Part of a picture drawn at a new size.</summary>
    private static SKBitmap Draw(SKBitmap src, SKRect from, int width, int height)
    {
        var dst = new SKBitmap(new SKImageInfo(width, height, SKColorType.Rgba8888, SKAlphaType.Premul));
        using var canvas = new SKCanvas(dst);
        using var image = SKImage.FromBitmap(src);
        canvas.DrawImage(image, from, SKRect.Create(0, 0, width, height), new SKSamplingOptions(SKCubicResampler.CatmullRom));
        return dst;
    }

    // ------------------------------------------------------------------ embeddings

    /// <summary>
    /// A stored product photo's numbers: the whole picture, fitted into a square
    /// with plain margins rather than cropped, so a full-length outfit keeps its
    /// hem and its neckline.
    /// </summary>
    public float[] Embed(SKBitmap picture)
    {
        var session = _session ?? throw new InvalidOperationException(Problem);

        using var square = new SKBitmap(new SKImageInfo(Side, Side, SKColorType.Rgba8888, SKAlphaType.Unpremul));
        using (var canvas = new SKCanvas(square))
        using (var image = SKImage.FromBitmap(picture))
        {
            canvas.Clear(new SKColor(124, 116, 104));   // the model's average colour: a margin that says nothing
            var scale = (float)Side / Math.Max(picture.Width, picture.Height);
            float dw = picture.Width * scale, dh = picture.Height * scale;
            canvas.DrawImage(image, SKRect.Create(0, 0, picture.Width, picture.Height),
                SKRect.Create((Side - dw) / 2, (Side - dh) / 2, dw, dh), new SKSamplingOptions(SKCubicResampler.CatmullRom));
        }

        var px = square.GetPixelSpan();
        var plane = Side * Side;
        var input = new float[3 * plane];
        for (var i = 0; i < plane; i++)
        {
            input[i] = (px[i * 4] / 255f - Mean[0]) / Std[0];
            input[plane + i] = (px[i * 4 + 1] / 255f - Mean[1]) / Std[1];
            input[2 * plane + i] = (px[i * 4 + 2] / 255f - Mean[2]) / Std[2];
        }

        using var results = session.Run(
            [NamedOnnxValue.CreateFromTensor("pixel_values", new DenseTensor<float>(input, [1, 3, Side, Side]))]);
        var hidden = results.First(r => r.Name == "last_hidden_state").AsTensor<float>();

        // The first token is the model's summary of the whole picture.
        var vector = new float[hidden.Dimensions[2]];
        for (var d = 0; d < vector.Length; d++) vector[d] = hidden[0, 0, d];
        return Normalise(vector);
    }

    /// <summary>
    /// A searched-with photo's numbers: the whole picture, and - when it is a
    /// screenshot or has a lot of plain space round it - just the busy part, so
    /// a chat's bars and bubbles do not outweigh the dress in it.
    /// </summary>
    public List<float[]> EmbedForSearch(SKBitmap picture)
    {
        var views = new List<float[]> { Embed(picture) };
        using var trimmed = Trim(picture);
        if (trimmed is not null) views.Add(Embed(trimmed));
        return views;
    }

    public static float Similarity(float[] a, float[] b)
    {
        var n = Math.Min(a.Length, b.Length);
        float sum = 0;
        for (var i = 0; i < n; i++) sum += a[i] * b[i];
        return sum;
    }

    public static byte[] ToBytes(float[] vector)
    {
        var bytes = new byte[vector.Length * sizeof(float)];
        Buffer.BlockCopy(vector, 0, bytes, 0, bytes.Length);
        return bytes;
    }

    public static float[] FromBytes(byte[] bytes)
    {
        var vector = new float[bytes.Length / sizeof(float)];
        Buffer.BlockCopy(bytes, 0, vector, 0, vector.Length * sizeof(float));
        return vector;
    }

    private static float[] Normalise(float[] v)
    {
        double sum = 0;
        foreach (var x in v) sum += x * x;
        var length = (float)Math.Sqrt(sum);
        if (length > 0) for (var i = 0; i < v.Length; i++) v[i] /= length;
        return v;
    }

    /// <summary>
    /// The busy block of a picture - the photo inside a screenshot, without the
    /// flat bars and background round it - or null when there is nothing worth
    /// cutting away.
    /// </summary>
    private static SKBitmap? Trim(SKBitmap src)
    {
        const int longSide = 320;
        var scale = Math.Min(1f, (float)longSide / Math.Max(src.Width, src.Height));
        int w = Math.Max(2, (int)(src.Width * scale)), h = Math.Max(2, (int)(src.Height * scale));

        byte[] px;
        using (var small = Draw(src, SKRect.Create(0, 0, src.Width, src.Height), w, h))
            px = small.GetPixelSpan().ToArray();

        // An edge is a jump in colour to the pixel on the left or above.
        bool Edge(int x, int y)
        {
            var i = (y * w + x) * 4;
            var left = i - 4;
            var up = i - w * 4;
            var d = Math.Abs(px[i] - px[left]) + Math.Abs(px[i + 1] - px[left + 1]) + Math.Abs(px[i + 2] - px[left + 2])
                  + Math.Abs(px[i] - px[up]) + Math.Abs(px[i + 1] - px[up + 1]) + Math.Abs(px[i + 2] - px[up + 2]);
            return d > 30;
        }

        var rowBusy = new bool[h];
        for (var y = 1; y < h; y++)
        {
            var edges = 0;
            for (var x = 1; x < w; x++) if (Edge(x, y)) edges++;
            rowBusy[y] = edges > w * 0.06;
        }
        var (y0, y1) = LongestRun(rowBusy, Math.Max(2, h / 40));
        if (y1 - y0 < h * 0.15) return null;

        var colBusy = new bool[w];
        for (var x = 1; x < w; x++)
        {
            var edges = 0;
            for (var y = Math.Max(1, y0); y <= y1; y++) if (Edge(x, y)) edges++;
            colBusy[x] = edges > (y1 - y0 + 1) * 0.06;
        }
        var (x0, x1) = LongestRun(colBusy, Math.Max(2, w / 40));
        if (x1 - x0 < w * 0.15) return null;

        // Cutting away almost nothing would only ask the same question twice.
        if ((double)(x1 - x0 + 1) * (y1 - y0 + 1) / ((double)w * h) > 0.85) return null;

        var from = SKRect.Create(x0 / scale, y0 / scale, (x1 - x0 + 1) / scale, (y1 - y0 + 1) / scale);
        from.Intersect(SKRect.Create(0, 0, src.Width, src.Height));
        return Draw(src, from, Math.Max(1, (int)from.Width), Math.Max(1, (int)from.Height));
    }

    /// <summary>The longest stretch of busy rows (or columns), allowing short quiet gaps inside it.</summary>
    private static (int Start, int End) LongestRun(bool[] busy, int gap)
    {
        int bestStart = 0, bestEnd = -1, start = -1, last = -1;
        for (var i = 0; i < busy.Length; i++)
        {
            if (!busy[i]) continue;
            if (start < 0 || i - last > gap) start = i;
            last = i;
            if (last - start > bestEnd - bestStart) (bestStart, bestEnd) = (start, last);
        }
        return (bestStart, bestEnd);
    }
}
