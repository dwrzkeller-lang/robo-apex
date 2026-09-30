# -*- coding: utf-8 -*-
"""Gera o icone do ROBO KELLER (mini grafico de candles subindo) em alta resolucao:
   app/web/icone.png (512), app/web/icone-64.png, app/robo.ico (16 a 256) e ferramentas/splash.png (tela do .exe).
   Uso: python ferramentas/gerar_icone.py   (precisa do Pillow)"""
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

RAIZ = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
S = 4096                                     # desenha grande e reduz (bordas lisas)


def mistura(a, b, t):
    return tuple(int(a[k] + (b[k] - a[k]) * t) for k in range(3))


def icone():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    # fundo: quadrado arredondado com degrade diagonal
    fundo = Image.new("RGBA", (S, S))
    px = fundo.load()
    c1, c2 = (12, 22, 44), (9, 92, 84)
    for y in range(0, S, 8):
        for x in range(0, S, 8):
            cor = mistura(c1, c2, (x + y) / (2 * S)) + (255,)
            for dy in range(8):
                for dx in range(8):
                    px[x + dx, y + dy] = cor
    mascara = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mascara).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=255)
    img.paste(fundo, (0, 0), mascara)
    # grade discreta (camada propria: desenhar com transparencia direto furaria o fundo)
    grade = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    dg = ImageDraw.Draw(grade)
    for k in range(1, 5):
        y = int(S * (0.18 + k * 0.15))
        dg.line([(int(S * 0.12), y), (int(S * 0.88), y)], fill=(255, 255, 255, 28), width=int(S * 0.005))
    img = Image.alpha_composite(img, grade)
    d = ImageDraw.Draw(img)
    # candles subindo
    verde, vermelho = (34, 227, 154, 255), (255, 92, 110, 255)
    candles = [  # x centro, abertura, fechamento, maxima, minima (em fracao da altura; 0 = topo)
        (0.25, 0.70, 0.60, 0.55, 0.76, verde),
        (0.40, 0.62, 0.66, 0.57, 0.71, vermelho),
        (0.55, 0.64, 0.46, 0.41, 0.68, verde),
        (0.70, 0.47, 0.30, 0.24, 0.50, verde),
    ]
    larg = S * 0.085
    for x, ab, fe, mx, mn, cor in candles:
        cx = S * x
        d.line([(cx, S * mx), (cx, S * mn)], fill=cor, width=int(S * 0.014))
        topo, base = min(ab, fe) * S, max(ab, fe) * S
        d.rounded_rectangle([cx - larg / 2, topo, cx + larg / 2, base], radius=int(S * 0.012), fill=cor)
    # linha de tendencia com seta (dourada, com brilho)
    pts = [(S * 0.14, S * 0.80), (S * 0.40, S * 0.60), (S * 0.55, S * 0.52), (S * 0.84, S * 0.20)]
    brilho = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(brilho).line(pts, fill=(255, 210, 63, 150), width=int(S * 0.05), joint="curve")
    brilho = brilho.filter(ImageFilter.GaussianBlur(S * 0.02))
    img = Image.alpha_composite(img, brilho)
    d = ImageDraw.Draw(img)
    d.line(pts, fill=(255, 214, 90, 255), width=int(S * 0.028), joint="curve")
    # ponta da seta
    ax, ay = pts[-1]
    d.polygon([(ax + S * 0.045, ay - S * 0.045), (ax - S * 0.075, ay - S * 0.020), (ax + S * 0.020, ay + S * 0.075)],
              fill=(255, 214, 90, 255))
    return img


def main():
    grande = icone()
    web = os.path.join(RAIZ, "app", "web")
    grande.resize((512, 512), Image.LANCZOS).save(os.path.join(web, "icone.png"))
    grande.resize((64, 64), Image.LANCZOS).save(os.path.join(web, "icone-64.png"))
    tamanhos = [16, 20, 24, 32, 40, 48, 64, 128, 256]
    grande.resize((256, 256), Image.LANCZOS).save(os.path.join(RAIZ, "app", "robo.ico"), sizes=[(t, t) for t in tamanhos])
    # tela de abertura do .exe (aparece enquanto o programa descompacta)
    sp = Image.new("RGBA", (520, 300), (13, 16, 22, 255))
    d = ImageDraw.Draw(sp)
    d.rectangle([0, 0, 519, 299], outline=(38, 47, 64, 255), width=2)
    sp.alpha_composite(grande.resize((120, 120), Image.LANCZOS), (40, 70))
    try:
        f1 = ImageFont.truetype("segoeuib.ttf", 40)
        f2 = ImageFont.truetype("segoeui.ttf", 16)
    except OSError:
        f1 = f2 = ImageFont.load_default()
    d.text((185, 88), "ROBÔ KELLER", font=f1, fill=(236, 242, 250, 255))
    d.text((188, 142), "Day trade informativo · não envia ordens", font=f2, fill=(138, 150, 168, 255))
    d.rounded_rectangle([188, 180, 480, 186], radius=3, fill=(34, 43, 59, 255))
    d.rounded_rectangle([188, 180, 300, 186], radius=3, fill=(0, 212, 160, 255))
    d.text((188, 196), "Iniciando…", font=f2, fill=(138, 150, 168, 255))
    sp.convert("RGB").save(os.path.join(RAIZ, "ferramentas", "splash.png"))
    print("ok: icone.png, icone-64.png, robo.ico, splash.png")


if __name__ == "__main__":
    main()
