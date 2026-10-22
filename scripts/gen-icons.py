#!/usr/bin/env python3
"""Genera le icone della PWA e la tessera del logo dal logo ORIGINALE (public/brand/chathel-logo-originale.jpg).
Il logo non viene mai ricolorato ne' ridisegnato: si ritaglia solo il margine bianco e si ridimensiona su fondo bianco.
Serve comunque il vettoriale dal proprietario (il JPG e' 535x535, a bassa risoluzione): rilanciare questo script quando arriva.
Uso: python3 scripts/gen-icons.py   (oppure: npm run icons). Richiede Pillow."""
from pathlib import Path
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "public" / "brand" / "chathel-logo-originale.jpg"
BRAND = ROOT / "public" / "brand"
ICONS = ROOT / "public" / "icons"
ICONS.mkdir(parents=True, exist_ok=True)

logo = Image.open(SRC).convert("RGB")
white = Image.new("RGB", logo.size, (255, 255, 255))
bbox = ImageChops.difference(logo, white).convert("L").point(lambda v: 255 if v > 40 else 0).getbbox()
content = logo.crop(bbox)  # solo il logo, senza margini (la scritta e' intera)

# Tessera per l'interfaccia: il logo con 12 px di bianco attorno (la tessera arrotondata la fa il CSS)
PAD = 12
x0, y0, x1, y1 = bbox
tile = logo.crop((max(0, x0 - PAD), max(0, y0 - PAD), min(logo.width, x1 + PAD), min(logo.height, y1 + PAD)))
tile.save(BRAND / "chathel-logo-tessera.png", optimize=True)
print("scritto brand/chathel-logo-tessera.png", tile.size)


# Simbolo (H con la C) senza la scritta: per le ICONE dell'app e delle notifiche (decisione di Lorenzo, 22/10/2026).
# Si taglia nella prima riga vuota sotto il simbolo; nessuna ricolorazione.
_dark = content.convert("L").point(lambda v: 255 if v < 200 else 0)
_rows = [_dark.crop((0, y, _dark.width, y + 1)).getbbox() is not None for y in range(_dark.height)]
_top = next(y for y, r in enumerate(_rows) if r)
_gap = next(y for y in range(_top, len(_rows)) if not _rows[y])
symbol = content.crop((0, 0, content.width, _gap))
print("simbolo", symbol.size)


def icon(name, size, fraction, src=None):
    """Immagine su fondo bianco, larga `fraction` del lato, centrata (di norma il solo simbolo)."""
    src = src or symbol
    w = round(size * fraction)
    h = round(src.height * w / src.width)
    if h > size * fraction:  # simbolo quasi quadrato: limitare anche l'altezza
        h = round(size * fraction)
        w = round(src.width * h / src.height)
    img = Image.new("RGB", (size, size), (255, 255, 255))
    img.paste(src.resize((w, h), Image.LANCZOS), ((size - w) // 2, (size - h) // 2))
    img.save(ICONS / name, optimize=True)
    print("scritto icons/" + name, size)


icon("icon-192.png", 192, 0.66)
icon("icon-512.png", 512, 0.66)
icon("icon-maskable-512.png", 512, 0.46)  # dentro la zona sicura (cerchio del 80%) delle maschere Android
icon("apple-touch-icon.png", 180, 0.60)   # iOS arrotonda da solo; nessuna trasparenza
