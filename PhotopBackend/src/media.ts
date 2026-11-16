import path from "node:path";
import fs from "node:fs";
import { generateId } from "./auth.js";
import { db } from "./db.js";

const mediaDir = path.resolve(process.cwd(), "media");
const postImagesDir = path.join(mediaDir, "PostImages");
const profileImagesDir = path.join(mediaDir, "ProfileImages");
const profileBannersDir = path.join(mediaDir, "ProfileBanners");

[mediaDir, postImagesDir, profileImagesDir, profileBannersDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Provide a default profile picture if one does not exist. New accounts start
// with this image until they upload their own.
const defaultProfilePicPath = path.join(profileImagesDir, "DefaultProfilePic");
const defaultProfilePicSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#5AB7FA"/>
      <stop offset="1" stop-color="#8B5CF6"/>
    </linearGradient>
  </defs>
  <rect width="256" height="256" fill="url(#bg)"/>
  <circle cx="128" cy="96" r="44" fill="#ffffff" fill-opacity="0.95"/>
  <path d="M 48 224 C 54 165 84 140 128 140 C 172 140 202 165 208 224 Z" fill="#ffffff" fill-opacity="0.95"/>
</svg>`;
if (!fs.existsSync(defaultProfilePicPath)) {
  fs.writeFileSync(defaultProfilePicPath, defaultProfilePicSvg);
}

export function savePostImage(postId: string, index: number, buffer: Buffer) {
  const filePath = path.join(postImagesDir, `${postId}${index}`);
  fs.writeFileSync(filePath, buffer);
}

// Uploaded images are stored without a file extension (the original Photop
// client reconstructs URLs from IDs), so `express.static` cannot work out the
// MIME type from the path. Sniff the magic bytes instead. Browsers refuse to
// render images that are served as `application/octet-stream`.
export function sniffMediaType(buffer: Buffer): string {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 6) {
    const header = buffer.subarray(0, 6).toString("latin1");
    if (header === "GIF87a" || header === "GIF89a") return "image/gif";
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("latin1") === "RIFF" && buffer.subarray(8, 12).toString("latin1") === "WEBP") {
    return "image/webp";
  }
  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return "image/bmp";
  }
  if (buffer.length >= 4) {
    const tiffLE = buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00;
    const tiffBE = buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a;
    if (tiffLE || tiffBE) return "image/tiff";
  }
  if (buffer.length >= 4 && buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && buffer[3] === 0x00) {
    return "image/x-icon";
  }
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("latin1");
    if (brand === "avif" || brand === "avis") return "image/avif";
    if (brand.startsWith("hei") || brand.startsWith("hev") || brand === "mif1" || brand === "msf1") return "image/heif";
  }

  // SVG is text-based, so look for the root <svg> element near the start.
  const head = buffer.subarray(0, 1024).toString("utf8");
  if (/<svg[\s>]/i.test(head)) return "image/svg+xml";

  return "application/octet-stream";
}

export function getMediaContentType(filePath: string): string {
  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(1024);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    return sniffMediaType(buffer.subarray(0, bytesRead));
  } catch {
    return "application/octet-stream";
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

export function saveProfileImage(userId: string, buffer: Buffer): string {
  const picId = generateId();
  const filePath = path.join(profileImagesDir, picId);
  fs.writeFileSync(filePath, buffer);

  // Update user's settings.ProfilePic in DB
  const user = db.prepare("SELECT settings FROM users WHERE id = ?").get(userId) as { settings: string } | undefined;
  if (user) {
    const settings = JSON.parse(user.settings || "{}");
    settings.ProfilePic = picId;
    db.prepare("UPDATE users SET settings = ? WHERE id = ?").run(JSON.stringify(settings), userId);
  }
  return picId;
}

export function saveProfileBanner(userId: string, buffer: Buffer): string {
  const bannerId = generateId();
  const filePath = path.join(profileBannersDir, bannerId);
  fs.writeFileSync(filePath, buffer);

  // Update user's settings.ProfileBanner in DB
  const user = db.prepare("SELECT settings FROM users WHERE id = ?").get(userId) as { settings: string } | undefined;
  if (user) {
    const settings = JSON.parse(user.settings || "{}");
    settings.ProfileBanner = bannerId;
    db.prepare("UPDATE users SET settings = ? WHERE id = ?").run(JSON.stringify(settings), userId);
  }
  return bannerId;
}

export { mediaDir };
