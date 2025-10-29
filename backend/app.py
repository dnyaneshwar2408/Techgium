import os
import json
from flask import Flask, request, jsonify
from dotenv import load_dotenv
import google.generativeai as genai
from flask_cors import CORS # Import CORS

# --- Initialization and Configuration ---

# Load environment variables (GOOGLE_API_KEY)
load_dotenv()

# Initialize the Flask web application
app = Flask(__name__)
# *** IMPORTANT: Enable CORS for your frontend ***
CORS(app, resources={r"/api/*": {"origins": "*"}}) # Allow all origins for the hackathon

# Configure the Google AI (Gemini) API
try:
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        print("ERROR: GOOGLE_API_KEY not found in .env file.")
        ai_model = None
    else:
        genai.configure(api_key=api_key)
        ai_model = genai.GenerativeModel('gemini-2.5-pro')

        print("Gemini AI Model configured successfully.")
except Exception as e:
    print(f"Error configuring Gemini API: {e}")
    ai_model = None

# --- Database Logic ---

def load_inventory_db():
    """Loads the inventory database from inventory.json on startup."""
    try:
        with open('inventory.json', 'r') as f:
            data = json.load(f)
            flat_db = {}
            for category_name, items in data.items():
                for item in items:
                    flat_db[item['part_number']] = item
            print(f"Successfully loaded {len(flat_db)} items from inventory.json.")
            return flat_db
    except FileNotFoundError:
        print("ERROR: 'inventory.json' not found. Logistics endpoints will fail.")
        return {}
    except Exception as e:
        print(f"Error loading inventory.json: {e}")
        return {}

# Load the database into memory
mock_inventory_db = load_inventory_db()

# --- AI Feature 1: The eBOM/mBOM Conversion ---

@app.route('/api/generate_plan', methods=['POST'])
def generate_plan():
    """
    This is your CORE AI feature.
    It takes a user's text and converts it into a full eBOM and mBOM plan.
    """
    if not ai_model:
        return jsonify({"error": "AI model is not configured"}), 500

    data = request.get_json()
    if not data or 'prompt_text' not in data:
        return jsonify({"error": "No prompt_text provided"}), 400

    user_prompt = data['prompt_text']
    
    # This is your new "Master Prompt" that satisfies all requirements
    master_prompt = f"""
    You are an L&T Manufacturing Engineer. A manager has made a request: "{user_prompt}".

    Your task is to convert this high-level request into a detailed plan.
    1.  First, generate the `eBOM_parts` list. Infer the part numbers and quantities needed from the inventory list I will provide.
    2.  Second, generate the `mBOM_steps` (the manufacturing plan) with locations.

    Here is a partial list of available parts in our inventory system:
    ["SCR-M4-001", "CHAS-ENC-001", "DIN-RAIL-1M", "TB-XYZ", "PSU-24V-5A", "WIRE-22G-RD", "SW-PB-GRN"]

    Our factory locations are: ["Station A", "Station B", "Station C", "Main Warehouse", "Painting Booth", "Quality Control"].

    Return ONLY a single, valid JSON object with this exact structure:
    {{
      "eBOM_parts": [
        {{"part_number": "Example: CHAS-ENC-001", "name": "Example: Small Enclosure", "quantity": 1}},
        {{"part_number": "Example: DIN-RAIL-1M", "name": "Example: 1m DIN Rail", "quantity": 2}},
        {{"part_number": "Example: SCR-M4-001", "name": "Example: M4 Screw", "quantity": 20}}
      ],
      "mBOM_steps": [
        {{"step": "1. Mount 2x DIN Rails to Enclosure", "location": "Station C"}},
        {{"step": "2. Attach 10x Terminal Blocks", "location": "Station C"}},
        {{"step": "3. Perform quality check", "location": "Quality Control"}}
      ]
    }}
    """
    
    try:
        response = ai_model.generate_content(master_prompt)
        # Simple JSON cleaning
        raw_text = response.text.strip().replace("```json", "").replace("```", "")
        plan = json.loads(raw_text)
        return jsonify(plan), 200
    except Exception as e:
        return jsonify({"error": f"Failed to generate or parse AI plan: {e}", "raw_response": response.text if 'response' in locals() else 'No response'}), 500


# --- AI Feature 2: The Logistics (Inventory & Sourcing) ---

@app.route('/api/check_inventory', methods=['POST'])
def check_inventory():
    """
    Checks the inventory for a list of parts, including their current station.
    Expects JSON: {{ "parts": [{{ "part_number": "SCR-M4-001", "location": "Station C" }}] }}
    """
    data = request.get_json()
    if not data or 'parts' not in data:
        return jsonify({"error": "Invalid request"}), 400
    
    requested_parts = data['parts']
    status_report = []

    for part_request in requested_parts:
        part_id = part_request.get('part_number')
        required_at = part_request.get('location') # The station where it's needed
        
        db_entry = mock_inventory_db.get(part_id)
        
        if not db_entry:
            status_report.append({"part_number": part_id, "status": "unknown_part"})
            continue

        # Check if the part is at the required station
        if db_entry['location'] == required_at and db_entry['quantity'] > 0:
            status_report.append({
                "part_number": part_id, 
                "status": "in_stock_local", 
                "quantity_local": db_entry['quantity'],
                "location": db_entry['location']
            })
        else:
            # It's not at the local station (or is 0 there)
            status_report.append({
                "part_number": part_id,
                "status": "out_of_stock_local",
                "required_at": required_at
            })

    return jsonify({"inventory_status": status_report}), 200


@app.route('/api/get_part_locations', methods=['GET'])
def get_part_locations():
    """
    Finds ALL locations for a specific part. This is for the map.
    Expects URL param: /api/get_part_locations?part_id=SCR-M4-001
    """
    part_id = request.args.get('part_id')
    if not part_id:
        return jsonify({"error": "part_id is required"}), 400

    locations_found = []
    for item in mock_inventory_db.values():
        if item['part_number'] == part_id and item['quantity'] > 0:
            locations_found.append({
                "location": item['location'],
                "quantity": item['quantity']
            })
            
    if not locations_found:
        return jsonify({"part_number": part_id, "locations": []}), 404

    return jsonify({"part_number": part_id, "locations": locations_found}), 200


# --- Main Application Runner ---
if __name__ == '__main__':
    if not ai_model:
        print("!!! WARNING: AI Model not loaded. Check your GOOGLE_API_KEY in .env file. !!!")
    app.run(debug=True, port=5000)