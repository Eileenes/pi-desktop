/** Byte-sniffing for the image types the desktop app accepts as attachments. */
export function getImageMimeType(content: Buffer): string | undefined {
	if (
		content.length >= 8 &&
		content[0] === 0x89 &&
		content[1] === 0x50 &&
		content[2] === 0x4e &&
		content[3] === 0x47 &&
		content[4] === 0x0d &&
		content[5] === 0x0a &&
		content[6] === 0x1a &&
		content[7] === 0x0a
	) {
		return "image/png";
	}
	if (content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) {
		return "image/jpeg";
	}
	if (
		content.length >= 6 &&
		(content.subarray(0, 6).toString("ascii") === "GIF87a" || content.subarray(0, 6).toString("ascii") === "GIF89a")
	) {
		return "image/gif";
	}
	if (
		content.length >= 12 &&
		content.subarray(0, 4).toString("ascii") === "RIFF" &&
		content.subarray(8, 12).toString("ascii") === "WEBP"
	) {
		return "image/webp";
	}
	return undefined;
}

export function imageExtensionFor(mimeType: string): string {
	return mimeType === "image/jpeg" ? "jpg" : mimeType === "image/x-icon" ? "ico" : (mimeType.split("/")[1] ?? "img");
}
