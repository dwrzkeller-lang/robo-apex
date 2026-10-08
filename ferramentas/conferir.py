# -*- coding: utf-8 -*-
"""Conferência rápida antes de publicar (funciona em qualquer computador ou na nuvem, sem navegador):
   1. todo arquivo .py compila;  2. todo .js da tela passa no `node --check` (se houver Node);
   3. o nome antigo do projeto não reapareceu;  4. o servidor sobe numa base vazia e responde com a versão certa.
   Uso:  python ferramentas/conferir.py"""
import json, os, re, shutil, subprocess, sys, tempfile, time, urllib.request

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(RAIZ, "app")
PORTA = 8793
problemas = 0


def confere(cond, nome, extra=""):
    global problemas
    if not cond:
        problemas += 1
    print(("ok    " if cond else "FALHOU"), nome, extra)


# 1. Python
for pasta in (APP, os.path.join(RAIZ, "ferramentas")):
    for n in sorted(os.listdir(pasta)):
        if n.endswith(".py"):
            try:
                compile(open(os.path.join(pasta, n), encoding="utf-8").read(), n, "exec")
            except SyntaxError as e:
                confere(False, "compila " + n, str(e))
confere(True, "arquivos .py conferidos")

# 2. JavaScript
node = shutil.which("node")
if node:
    web = os.path.join(APP, "web")
    for n in sorted(os.listdir(web)):
        if n.endswith(".js") and n != "lightweight-charts.js":
            r = subprocess.run([node, "--check", os.path.join(web, n)], capture_output=True, text=True)
            if r.returncode:
                confere(False, "sintaxe " + n, r.stderr[:300])
    confere(True, "arquivos .js conferidos")
else:
    print("aviso  Node não encontrado: os .js não foram conferidos")

# 3. nome antigo
antigo = "kel" + "ler"
achados = []
for base, pastas, arqs in os.walk(RAIZ):
    pastas[:] = [p for p in pastas if p not in (".git", "dados", "__pycache__", "build", "dist")]
    for n in arqs:
        if n.rsplit(".", 1)[-1] in ("py", "js", "html", "css", "md", "txt", "bat", "spec"):
            try:
                if antigo in open(os.path.join(base, n), encoding="utf-8", errors="ignore").read().lower():
                    achados.append(n)
            except OSError:
                pass
confere(not achados, "o nome antigo não aparece em lugar nenhum", ", ".join(achados))

# 4. o servidor sobe
versao = re.search(r'VERSAO = "([^"]+)"', open(os.path.join(APP, "robo_apex.py"), encoding="utf-8").read()).group(1)
base = tempfile.mkdtemp(prefix="apex_conf_")
env = dict(os.environ, PYTHONIOENCODING="utf-8")
p = subprocess.Popen([sys.executable, os.path.join(APP, "robo_apex.py"), "--sem-janela", "--sem-base", "--porta", str(PORTA), "--base", base],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)
try:
    j = None
    for _ in range(30):
        time.sleep(0.5)
        try:
            j = json.loads(urllib.request.urlopen("http://127.0.0.1:%d/api/acesso/estado" % PORTA, timeout=2).read().decode("utf-8"))
            break
        except Exception:
            pass
    confere(bool(j) and j.get("versao") == versao, "o servidor sobe e responde como versão " + versao, "" if j else "sem resposta")
    if j:
        html = urllib.request.urlopen("http://127.0.0.1:%d/entrar.html" % PORTA, timeout=5).read().decode("utf-8", "ignore")
        confere("APEX" in html.upper(), "a tela de entrada é servida")
finally:
    p.terminate()
    try:
        p.wait(timeout=5)
    except Exception:
        p.kill()
    shutil.rmtree(base, ignore_errors=True)

print("PROBLEMAS:", problemas)
sys.exit(1 if problemas else 0)
