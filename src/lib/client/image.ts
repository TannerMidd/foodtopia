const MAX_LONG_EDGE = 1600;
export const MAX_IMAGE_BYTES = 5_000_000;

async function loadDrawable(file: File): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  cleanup: () => void;
}> {
  if ("createImageBitmap" in window) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => bitmap.close(),
      };
    } catch {
      // Some Chromium/WebKit decoders reject otherwise displayable image types.
      // The HTMLImageElement path below provides a compatible fallback.
    }
  }

  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  await image.decode();
  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    cleanup: () => URL.revokeObjectURL(url),
  };
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("The photo could not be converted."))),
      "image/jpeg",
      quality,
    );
  });
}

export async function prepareInventoryPhoto(file: File, index: number): Promise<File> {
  if (!file.type.startsWith("image/")) {
    throw new Error(`${file.name} is not an image.`);
  }

  let drawable: Awaited<ReturnType<typeof loadDrawable>>;
  try {
    drawable = await loadDrawable(file);
  } catch {
    throw new Error(
      `${file.name} could not be opened. If it is HEIC, choose “Most Compatible” in camera settings or take a new photo here.`,
    );
  }

  try {
    let scale = Math.min(1, MAX_LONG_EDGE / Math.max(drawable.width, drawable.height));
    let quality = 0.88;
    let blob: Blob | null = null;

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(drawable.width * scale));
      canvas.height = Math.max(1, Math.round(drawable.height * scale));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("This browser cannot prepare photos.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(drawable.source, 0, 0, canvas.width, canvas.height);
      blob = await canvasToBlob(canvas, quality);
      if (blob.size <= MAX_IMAGE_BYTES) break;
      if (quality > 0.58) quality -= 0.1;
      else scale *= 0.82;
    }

    if (!blob || blob.size > MAX_IMAGE_BYTES) {
      throw new Error(`${file.name} is still over 5 MB after resizing. Try a closer, simpler photo.`);
    }

    const baseName = file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 150);
    return new File([blob], `${baseName || `food-batch-${index + 1}`}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } finally {
    drawable.cleanup();
  }
}

export function formatFileSize(bytes: number) {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1_000))} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
