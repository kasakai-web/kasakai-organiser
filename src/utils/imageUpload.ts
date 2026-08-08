// Client-side rules for profile pictures.
//
// These mirror kasakai-backend/src/utils/imageValidation.js. The server is the
// one that decides — it re-checks the decoded bytes, not just the mimetype the
// browser reports — but catching an obviously wrong file here saves the user a
// pointless upload and gives an instant, specific error.

export const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_PROFILE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const PROFILE_IMAGE_ACCEPT_ATTR = ACCEPTED_PROFILE_IMAGE_TYPES.join(",");

export const formatFileSize = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** null when the file looks uploadable, otherwise the message to show. */
export const validateProfileImageFile = (file: File | null | undefined): string | null => {
  if (!file || file.size === 0) return "That file is empty — pick another image.";
  if (!ACCEPTED_PROFILE_IMAGE_TYPES.includes(file.type)) {
    return "Only JPEG, PNG and WebP images are allowed.";
  }
  if (file.size > MAX_PROFILE_IMAGE_BYTES) {
    return `That image is ${formatFileSize(file.size)}. Please pick one under 5 MB.`;
  }
  return null;
};

export type ProfileImageResponse = {
  success?: boolean;
  message?: string;
  data?: { profileImage?: string; uploadedImage?: { bytes?: number; width?: number; height?: number } };
};

export type UploadPhase = "sending" | "processing";

type UploadArgs = {
  url: string;
  file: File;
  token: string;
  fieldName?: string;
  /**
   * Called as the bytes leave the browser, then once more with phase
   * "processing" — the server still has to decode and compress the image after
   * the last byte arrives, and a bar frozen at 100% looks like a hang.
   */
  onProgress?: (percent: number, phase: UploadPhase) => void;
};

/**
 * POST a profile picture as multipart/form-data with real upload progress.
 * fetch() can't report progress on a request body, so this uses XMLHttpRequest.
 *
 * Resolves with the server's status and parsed body for any HTTP response —
 * including 4xx, which the caller renders as an error. Rejects only when the
 * request never completed (offline, DNS failure, connection dropped).
 */
export const uploadProfileImage = ({
  url,
  file,
  token,
  fieldName = "profileImage",
  onProgress,
}: UploadArgs): Promise<{ status: number; body: ProfileImageResponse }> =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      // Hold at 99 until the server answers, so the bar can't claim to be done
      // while compression is still running.
      onProgress?.(Math.min(99, Math.round((event.loaded / event.total) * 100)), "sending");
    };
    xhr.upload.onload = () => onProgress?.(100, "processing");

    xhr.onload = () => {
      let body: ProfileImageResponse = {};
      try {
        body = JSON.parse(xhr.responseText) as ProfileImageResponse;
      } catch {
        // A proxy or gateway error page — leave body empty and let the caller
        // fall back to a generic message.
      }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));

    const form = new FormData();
    form.append(fieldName, file);
    xhr.send(form);
  });
