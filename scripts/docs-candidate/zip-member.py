"""Read one bounded regular ZIP member as data. Never extract or execute files."""
import io
import stat
import sys
import zipfile


def selected_member(data, member, maximum):
    if not 0 < len(data) <= 64 * 1024 * 1024:
        raise ValueError("zip-bound")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        if not 0 < len(entries) <= 20000:
            raise ValueError("member-bound")
        names = set()
        expanded = 0
        selected = None
        for entry in entries:
            name = entry.filename
            parts = name.rstrip("/").split("/")
            if (name != entry.orig_filename or not name or len(name) > 4096
                    or "\\" in name or ":" in name or name.startswith("/")
                    or any(part in ("", ".", "..") for part in parts)
                    or any(ord(char) < 32 or ord(char) == 127 for char in name)
                    or name.lower() in names or entry.flag_bits & 1):
                raise ValueError("member-path")
            names.add(name.lower())
            expanded += entry.file_size
            if expanded > 256 * 1024 * 1024:
                raise ValueError("expanded-bound")
            if entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                raise ValueError("member-compression")
            if name == member:
                mode = entry.external_attr >> 16
                if entry.is_dir() or not stat.S_ISREG(mode) or entry.file_size != maximum:
                    raise ValueError("selected-member")
                selected = entry
        if selected is None:
            raise ValueError("missing-member")
        with archive.open(selected) as stream:
            value = stream.read(maximum + 1)
            if len(value) != maximum or stream.read(1):
                raise ValueError("selected-length")
            return value


if __name__ == "__main__":
    try:
        if len(sys.argv) != 3:
            raise ValueError("arguments")
        limit = int(sys.argv[2])
        if not 0 < limit <= 32 * 1024 * 1024:
            raise ValueError("member-bound")
        data = sys.stdin.buffer.read(64 * 1024 * 1024 + 1)
        sys.stdout.buffer.write(selected_member(data, sys.argv[1], limit))
    except Exception:
        sys.stderr.write("docs-input-zip-refused\n")
        sys.exit(2)
