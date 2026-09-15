from io import BytesIO
from pathlib import Path
import warnings
from PIL import Image, ImageOps, UnidentifiedImageError
from .db import Repo, utc_now
from .errors import AppError, Missing, Forbidden
from .security import new_id, throttled


class PhotoService:
    def __init__(self, db, settings):
        self.db, self.settings = db, settings

    def upload(self, actor, content, content_type):
        if len(content) > self.settings.max_upload_bytes:
            raise AppError("Photo must be 5 MB or smaller.", "UPLOAD_TOO_LARGE", 413)
        if content_type not in {"image/jpeg", "image/png", "image/webp"}:
            raise AppError("Choose a JPEG, PNG or WebP photo.", "UNSUPPORTED_IMAGE", 415)
        throttled(self.db, "photo", actor["id"], 60, 900)
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(BytesIO(content)) as image:
                    if image.format not in {"JPEG", "PNG", "WEBP"}:
                        raise AppError("The photo content does not match a supported image format.")
                    if image.width * image.height > 24_000_000:
                        raise AppError("Photo resolution exceeds 24 megapixels. Use a smaller image.")
                    if getattr(image, "n_frames", 1) > 1:
                        raise AppError("Use a still photo, not an animated image.")
                    image.load()
                    image = ImageOps.exif_transpose(image)
                    image.thumbnail((1920, 1920))
                    # Re-encoding strips EXIF/GPS and active/extra payloads.
                    image = image.convert("RGB")
                    output = BytesIO()
                    image.save(output, format="JPEG", quality=86, optimize=True)
                    sanitized = output.getvalue()
        except AppError:
            raise
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
            raise AppError("This file could not be read safely as a photo.", "INVALID_IMAGE", 422)
        photo_id = new_id("IMG")
        self.settings.upload_dir.mkdir(parents=True, exist_ok=True)
        filename = photo_id + ".jpg"
        path = self.settings.upload_dir / filename
        # Exclusive create; content is never served by a public static mount.
        with path.open("xb") as handle:
            handle.write(sanitized)
        try:
            with self.db.transaction(write=True) as conn:
                repo = Repo(conn, actor["business_id"])
                repo.insert("photos", {"id": photo_id, "user_id": actor["id"], "path": filename, "mime": "image/jpeg", "size": len(sanitized), "created_at": utc_now()})
        except Exception:
            path.unlink(missing_ok=True)
            raise
        return {"id": photo_id, "url": f"/api/photos/{photo_id}"}

    def get(self, actor, photo_id):
        with self.db.transaction() as conn:
            repo = Repo(conn, actor["business_id"])
            photo = repo.one("photos", photo_id)
            if not photo:
                raise Missing("Photo")
            if actor["role"] != "owner" and photo["user_id"] != actor["id"]:
                # Workers may view a photo the owner attached to their own record.
                linked = repo.rows("submissions", "photo_id=? AND worker_id=?", (photo_id, actor["id"]), order="", limit=1)
                if not linked:
                    raise Forbidden()
            root = self.settings.upload_dir.resolve()
            path = (root / photo["path"]).resolve()
            if path.parent != root or not path.is_file():
                raise Missing("Photo")
            return path
