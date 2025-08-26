from flask import Flask, request, jsonify
import random

app = Flask(__name__)

# Contoh bot sederhana
@app.route("/")
def home():
    return "Bot saya aktif ✅"

@app.route("/signal", methods=["GET"])
def signal():
    # Contoh simple sinyal BUY/SELL
    signals = ["BUY", "SELL", "WAIT"]
    pick = random.choice(signals)
    return jsonify({
        "status": "ok",
        "signal": pick
    })

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)
