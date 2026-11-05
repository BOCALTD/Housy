/** Profile pictures: what is accepted. The browser resizes them first (components/ProfileMedia.tsx); this is the server's check. */
export type ProfileImageKind = "avatar" | "cover";
export const PROFILE_IMAGE_LIMIT: Record<ProfileImageKind, number> = { avatar: 600 * 1024, cover: 1600 * 1024 };
const MAGIC: Record<string, number[]> = { "image/jpeg": [0xff, 0xd8, 0xff], "image/png": [0x89, 0x50, 0x4e, 0x47], "image/webp": [0x52, 0x49, 0x46, 0x46] };

export function checkProfileImage(kind: ProfileImageKind, type: string, bytes: Uint8Array) {
  const magic = MAGIC[type];
  if (!magic) throw new Error("Use a JPG, PNG or WEBP picture");
  if (!bytes.byteLength) throw new Error("The picture is empty");
  if (bytes.byteLength > PROFILE_IMAGE_LIMIT[kind]) throw new Error(`That picture is too large (the most is ${Math.round(PROFILE_IMAGE_LIMIT[kind] / 1024)} KB after resizing)`);
  if (!magic.every((b, i) => bytes[i] === b)) throw new Error("The file is not the picture type it claims to be");
  if (type === "image/webp" && String.fromCharCode(...bytes.slice(8, 12)) !== "WEBP") throw new Error("The file is not the picture type it claims to be");
}
