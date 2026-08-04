import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PROFILE_IMAGE_BYTES,
  PROFILE_IMAGE_ACCEPT_ATTR,
  formatFileSize,
  uploadProfileImage,
  validateProfileImageFile,
} from "./imageUpload.ts";

// The same helper is duplicated in user-portal/src/utils/imageUpload.ts — this
// repo keeps each portal self-contained (see utils/api.ts), so a change to one
// belongs in the other too.

const fileOf = (bytes: number, type: string, name = "photo.jpg") =>
  new File([new Uint8Array(bytes)], name, { type });

test("validate: accepted types under the cap pass", () => {
  for (const type of ["image/jpeg", "image/png", "image/webp"]) {
    assert.equal(validateProfileImageFile(fileOf(1024, type)), null, type);
  }
  assert.equal(validateProfileImageFile(fileOf(MAX_PROFILE_IMAGE_BYTES, "image/jpeg")), null);
});

test("validate: unsupported types are named in the message", () => {
  for (const type of ["image/gif", "image/svg+xml", "image/avif", "application/pdf", ""]) {
    const message = validateProfileImageFile(fileOf(1024, type));
    assert.match(String(message), /JPEG, PNG and WebP/, type);
  }
});

test("validate: anything over 5 MB is rejected with its actual size", () => {
  const message = validateProfileImageFile(fileOf(MAX_PROFILE_IMAGE_BYTES + 1, "image/jpeg"));
  assert.match(String(message), /5\.0 MB/);
  assert.match(String(message), /under 5 MB/);
});

test("validate: a missing or empty file is rejected", () => {
  assert.ok(validateProfileImageFile(null));
  assert.ok(validateProfileImageFile(fileOf(0, "image/jpeg")));
});

test("validate: the accept attribute matches what the server allows", () => {
  assert.equal(PROFILE_IMAGE_ACCEPT_ATTR, "image/jpeg,image/png,image/webp");
});

test("formatFileSize: KB below a megabyte, MB above", () => {
  assert.equal(formatFileSize(400), "1 KB");
  assert.equal(formatFileSize(48_000), "47 KB");
  assert.equal(formatFileSize(5 * 1024 * 1024), "5.0 MB");
});

// ── upload transport ─────────────────────────────────────────────────────────

type FakeXhrScript = { status: number; responseText: string; fail?: boolean };

// Minimal XMLHttpRequest stand-in: records what was sent, then replays the
// scripted upload-progress events and response.
function installFakeXhr(script: FakeXhrScript) {
  const calls: { method: string; url: string; headers: Record<string, string>; body: FormData | null } = {
    method: "", url: "", headers: {}, body: null,
  };

  class FakeXhr {
    upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void; onload?: () => void } = {};
    onload?: () => void;
    onerror?: () => void;
    onabort?: () => void;
    status = 0;
    responseText = "";

    open(method: string, url: string) { calls.method = method; calls.url = url; }
    setRequestHeader(key: string, value: string) { calls.headers[key] = value; }
    send(body: FormData) {
      calls.body = body;
      queueMicrotask(() => {
        if (script.fail) { this.onerror?.(); return; }
        this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
        this.upload.onprogress?.({ lengthComputable: true, loaded: 100, total: 100 });
        this.upload.onload?.();
        this.status = script.status;
        this.responseText = script.responseText;
        this.onload?.();
      });
    }
  }

  const original = (globalThis as Record<string, unknown>).XMLHttpRequest;
  (globalThis as Record<string, unknown>).XMLHttpRequest = FakeXhr;
  return { calls, restore: () => { (globalThis as Record<string, unknown>).XMLHttpRequest = original; } };
}

test("upload: sends multipart with the bearer token and reports progress", async () => {
  const stored = { success: true, data: { profileImage: "https://cdn.test/x.webp", uploadedImage: { bytes: 4321 } } };
  const xhr = installFakeXhr({ status: 200, responseText: JSON.stringify(stored) });
  const seen: Array<[number, string]> = [];

  try {
    const result = await uploadProfileImage({
      url: "https://api.test/players/me/profile-image",
      file: fileOf(2048, "image/jpeg"),
      token: "tok-123",
      onProgress: (percent, phase) => seen.push([percent, phase]),
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.data?.profileImage, "https://cdn.test/x.webp");
    assert.equal(result.body.data?.uploadedImage?.bytes, 4321);

    assert.equal(xhr.calls.method, "POST");
    assert.equal(xhr.calls.headers.Authorization, "Bearer tok-123");
    assert.ok(xhr.calls.body instanceof FormData);
    assert.ok(xhr.calls.body?.get("profileImage") instanceof File);

    // Never claims 100% while the server is still compressing.
    assert.deepEqual(seen, [[50, "sending"], [99, "sending"], [100, "processing"]]);
  } finally {
    xhr.restore();
  }
});

test("upload: a 4xx resolves with the server's message instead of throwing", async () => {
  const xhr = installFakeXhr({
    status: 415,
    responseText: JSON.stringify({ success: false, message: "Only JPEG, PNG and WebP images are allowed" }),
  });

  try {
    const result = await uploadProfileImage({
      url: "https://api.test/upload",
      file: fileOf(1024, "image/jpeg"),
      token: "tok",
    });
    assert.equal(result.status, 415);
    assert.equal(result.body.success, false);
    assert.match(String(result.body.message), /JPEG, PNG and WebP/);
  } finally {
    xhr.restore();
  }
});

test("upload: a non-JSON gateway error still resolves with its status", async () => {
  const xhr = installFakeXhr({ status: 502, responseText: "<html>Bad Gateway</html>" });

  try {
    const result = await uploadProfileImage({
      url: "https://api.test/upload",
      file: fileOf(1024, "image/png"),
      token: "tok",
    });
    assert.equal(result.status, 502);
    assert.deepEqual(result.body, {});
  } finally {
    xhr.restore();
  }
});

test("upload: a dropped connection rejects", async () => {
  const xhr = installFakeXhr({ status: 0, responseText: "", fail: true });

  try {
    await assert.rejects(
      () => uploadProfileImage({ url: "https://api.test/upload", file: fileOf(1024, "image/jpeg"), token: "tok" }),
      /Network error/,
    );
  } finally {
    xhr.restore();
  }
});
