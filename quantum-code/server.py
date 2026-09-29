from flask import Flask, request, jsonify
from flask_cors import CORS
import subprocess
import sys
import tempfile
import os

app = Flask(__name__)
CORS(app)


@app.route("/run", methods=["POST"])
def run_code():

    data = request.get_json()

    if not data or "code" not in data:
        return jsonify({
            "success": False,
            "error": "No code received."
        })

    code = data["code"]

    if not isinstance(code, str):
        return jsonify({
            "success": False,
            "error": "Invalid code."
        })

    temp_file = None

    try:

        with tempfile.NamedTemporaryFile(
            mode="w",
            suffix=".py",
            delete=False,
            encoding="utf-8"
        ) as f:

            f.write("import sys\n")
            f.write("sys.stdout.reconfigure(encoding='utf-8')\n")
            f.write("sys.stderr.reconfigure(encoding='utf-8')\n")
            f.write(code)
            temp_file = f.name

        result = subprocess.run(
             [sys.executable, temp_file],
                 capture_output=True,
                 text=True,
                 encoding="utf-8",
                 errors="replace",
                timeout=20
)

        if result.returncode == 0:

            return jsonify({
                "success": True,
                "output": result.stdout
            })

        else:

            return jsonify({
                "success": False,
                "error": result.stderr
            })

    except subprocess.TimeoutExpired:

        return jsonify({
            "success": False,
            "error": "Execution stopped: code took too long to run."
        })

    except Exception as e:

        return jsonify({
            "success": False,
            "error": str(e)
        })

    finally:

        if temp_file and os.path.exists(temp_file):
            os.remove(temp_file)


if __name__ == "__main__":

    print("⚛️ Quantum Code Server")
    print("Running at http://127.0.0.1:5000")

    app.run(
        host="127.0.0.1",
        port=5000,
        debug=False
    )