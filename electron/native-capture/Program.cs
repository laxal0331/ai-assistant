using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;

internal static class Program
{
    private const int SM_CXSCREEN = 0;
    private const int SM_CYSCREEN = 1;
    private const int SRCCOPY = 0x00CC0020;
    private const int CAPTUREBLT = 0x40000000;

    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int nIndex);

    [DllImport("user32.dll")]
    private static extern IntPtr GetDC(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern int ReleaseDC(IntPtr hWnd, IntPtr hDc);

    [DllImport("gdi32.dll")]
    private static extern IntPtr CreateCompatibleDC(IntPtr hdc);

    [DllImport("gdi32.dll")]
    private static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int cx, int cy);

    [DllImport("gdi32.dll")]
    private static extern IntPtr SelectObject(IntPtr hdc, IntPtr h);

    [DllImport("gdi32.dll")]
    private static extern bool BitBlt(IntPtr hdc, int x, int y, int cx, int cy, IntPtr hdcSrc, int x1, int y1, int rop);

    [DllImport("gdi32.dll")]
    private static extern bool DeleteDC(IntPtr hdc);

    [DllImport("gdi32.dll")]
    private static extern bool DeleteObject(IntPtr ho);

    private static int Main(string[] args)
    {
        try
        {
            SetProcessDPIAware();

            if (args.Length < 3)
            {
                Console.Error.WriteLine("Usage: native-capture.exe <output.jpg> <maxDimension> <jpegQuality>");
                return 2;
            }

            string outputPath = args[0];
            int maxDimension = Math.Max(1, int.Parse(args[1]));
            long jpegQuality = Math.Max(1, Math.Min(100, long.Parse(args[2])));

            int width = GetSystemMetrics(SM_CXSCREEN);
            int height = GetSystemMetrics(SM_CYSCREEN);
            if (width <= 0 || height <= 0)
            {
                throw new InvalidOperationException("Invalid screen size");
            }

            using (Bitmap bitmap = CapturePrimaryScreen(width, height))
            using (Bitmap outputImage = ResizeIfNeeded(bitmap, maxDimension))
            {
                SaveJpeg(outputImage, outputPath, jpegQuality);
                Console.WriteLine(
                    "screen={0}x{1} output={2}x{3}",
                    width,
                    height,
                    outputImage.Width,
                    outputImage.Height
                );
            }

            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex);
            return 1;
        }
    }

    private static Bitmap CapturePrimaryScreen(int width, int height)
    {
        IntPtr sourceDc = GetDC(IntPtr.Zero);
        if (sourceDc == IntPtr.Zero)
        {
            throw new InvalidOperationException("GetDC failed");
        }

        IntPtr memoryDc = IntPtr.Zero;
        IntPtr bitmapHandle = IntPtr.Zero;
        IntPtr previousObject = IntPtr.Zero;

        try
        {
            memoryDc = CreateCompatibleDC(sourceDc);
            if (memoryDc == IntPtr.Zero)
            {
                throw new InvalidOperationException("CreateCompatibleDC failed");
            }

            bitmapHandle = CreateCompatibleBitmap(sourceDc, width, height);
            if (bitmapHandle == IntPtr.Zero)
            {
                throw new InvalidOperationException("CreateCompatibleBitmap failed");
            }

            previousObject = SelectObject(memoryDc, bitmapHandle);
            if (previousObject == IntPtr.Zero)
            {
                throw new InvalidOperationException("SelectObject failed");
            }

            if (!BitBlt(memoryDc, 0, 0, width, height, sourceDc, 0, 0, SRCCOPY | CAPTUREBLT))
            {
                throw new InvalidOperationException("BitBlt failed");
            }

            using (Bitmap captured = Image.FromHbitmap(bitmapHandle))
            {
                return new Bitmap(captured);
            }
        }
        finally
        {
            if (previousObject != IntPtr.Zero && memoryDc != IntPtr.Zero)
            {
                SelectObject(memoryDc, previousObject);
            }
            if (bitmapHandle != IntPtr.Zero)
            {
                DeleteObject(bitmapHandle);
            }
            if (memoryDc != IntPtr.Zero)
            {
                DeleteDC(memoryDc);
            }
            ReleaseDC(IntPtr.Zero, sourceDc);
        }
    }

    private static Bitmap ResizeIfNeeded(Bitmap source, int maxDimension)
    {
        int maxSide = Math.Max(source.Width, source.Height);
        if (maxSide <= maxDimension)
        {
            return new Bitmap(source);
        }

        double ratio = maxDimension / (double)maxSide;
        int width = Math.Max(1, (int)Math.Round(source.Width * ratio));
        int height = Math.Max(1, (int)Math.Round(source.Height * ratio));
        Bitmap resized = new Bitmap(width, height);

        using (Graphics graphics = Graphics.FromImage(resized))
        {
            graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
            graphics.SmoothingMode = SmoothingMode.HighQuality;
            graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
            graphics.DrawImage(source, 0, 0, width, height);
        }

        return resized;
    }

    private static void SaveJpeg(Image image, string outputPath, long quality)
    {
        string directory = Path.GetDirectoryName(outputPath);
        if (!string.IsNullOrWhiteSpace(directory))
        {
            Directory.CreateDirectory(directory);
        }

        ImageCodecInfo codec = ImageCodecInfo.GetImageEncoders().FirstOrDefault(item => item.MimeType == "image/jpeg");
        if (codec == null)
        {
            throw new InvalidOperationException("JPEG encoder not found");
        }

        using (EncoderParameters parameters = new EncoderParameters(1))
        {
            parameters.Param[0] = new EncoderParameter(Encoder.Quality, quality);
            image.Save(outputPath, codec, parameters);
        }
    }
}
