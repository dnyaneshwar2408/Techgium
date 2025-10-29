// Set the base URL for your backend API
const API_URL = "http://127.0.0.1:5000/api";

document.addEventListener("DOMContentLoaded", () => {
    // Get all the DOM elements
    const generateBtn = document.getElementById("generate-btn");
    const promptInput = document.getElementById("prompt-input");
    const loading = document.getElementById("loading");
    const resultsContainer = document.getElementById("results-container");
    const ebomList = document.getElementById("ebom-list");
    const mbomList = document.getElementById("mbom-list");
    
    // Modal elements
    const modalBackdrop = document.getElementById("modal-backdrop");
    const closeModal = document.getElementById("close-modal");
    const modalPartName = document.getElementById("modal-part-name");
    const aiAdvice = document.getElementById("ai-advice");
    const requestQtyInput = document.getElementById("request-qty");
    const requestSourceSelect = document.getElementById("request-source");
    const raiseRequestBtn = document.getElementById("raise-request-btn");
    const pins = document.querySelectorAll(".pin");

    // Store the current plan data
    let currentPlan = {};

    // --- Step 1: Generate the Plan ---
    generateBtn.addEventListener("click", async () => {
        const promptText = promptInput.value;
        if (!promptText) {
            alert("Please enter a request.");
            return;
        }

        // Show loading and hide old results
        loading.classList.remove("hidden");
        resultsContainer.classList.add("hidden");
        ebomList.innerHTML = "";
        mbomList.innerHTML = "";

        try {
            // --- AI Call 1: Generate Plan ---
            const planResponse = await fetch(`${API_URL}/generate_plan`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt_text: promptText }),
            });

            if (!planResponse.ok) {
                throw new Error(await planResponse.text());
            }

            const plan = await planResponse.json();
            currentPlan = plan; // Save the plan
            
            // --- AI Call 2: Check Inventory (Chained) ---
            // Build the request for the inventory check
            const inventoryCheckPayload = {
                parts: []
            };
            
            // Find which part is needed at which station
            plan.eBOM_parts.forEach(part => {
                // Find the first mBOM step that uses this part's location
                const step = plan.mBOM_steps.find(s => s.step.includes(part.name) || s.step.includes(part.part_number));
                inventoryCheckPayload.parts.push({
                    part_number: part.part_number,
                    location: step ? step.location : "Main Warehouse" // Default to warehouse if no step found
                });
            });

            const inventoryResponse = await fetch(`${API_URL}/check_inventory`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(inventoryCheckPayload),
            });
            
            const inventory = await inventoryResponse.json();
            
            // --- Render Everything ---
            renderPlanUI(plan.eBOM_parts, plan.mBOM_steps, inventory.inventory_status);
            
            loading.classList.add("hidden");
            resultsContainer.classList.remove("hidden");

        } catch (error) {
            console.error("Error generating plan:", error);
            alert("Error generating plan. Check console for details.");
            loading.classList.add("hidden");
        }
    });

    // --- Step 2: Render the UI with Inventory Status ---
    function renderPlanUI(ebomParts, mbomSteps, inventoryStatus) {
        // Render eBOM
        ebomParts.forEach(part => {
            const li = document.createElement("li");
            const status = inventoryStatus.find(s => s.part_number === part.part_number);
            
            let statusHTML = "";
            if (status && status.status === "in_stock_local") {
                statusHTML = `<span class="status status-green">In Stock (${status.quantity_local})</span>`;
            } else if (status && status.status === "out_of_stock_local") {
                statusHTML = `<span class="status status-red" data-part-id="${part.part_number}" data-required-qty="${part.quantity}" data-required-at="${status.required_at}">Out of Stock at ${status.required_at}</span>`;
            }

            li.innerHTML = `<strong>${part.name} (x${part.quantity})</strong> [${part.part_number}] ${statusHTML}`;
            ebomList.appendChild(li);
        });

        // Render mBOM
        mbomSteps.forEach(step => {
            const li = document.createElement("li");
            li.textContent = `${step.step} [Location: ${step.location}]`;
            mbomList.appendChild(li);
        });

        // Add click listeners to all "Out of Stock" buttons
        document.querySelectorAll(".status-red").forEach(el => {
            el.addEventListener("click", () => {
                openRequestModal(
                    el.dataset.partId,
                    el.dataset.requiredQty,
                    el.dataset.requiredAt
                );
            });
        });
    }

    // --- Step 3: Open the Sourcing Modal ---
    async function openRequestModal(partId, requiredQty, requiredAt) {
        const partName = currentPlan.eBOM_parts.find(p => p.part_number === partId).name;
        
        // Reset modal
        modalPartName.textContent = `${partName} (${partId})`;
        requestSourceSelect.innerHTML = "";
        pins.forEach(pin => pin.className = "pin"); // Reset pin colors

        // Set AI Advice
        aiAdvice.innerHTML = `Plan requires: <strong>${requiredQty}</strong> units.<br>
                              Your station (${requiredAt}) has: <strong>0</strong>.<br>
                              <strong>Deficit: ${requiredQty}</strong>`;
        requestQtyInput.value = requiredQty;

        // --- AI Call 3: Find locations for the map ---
        try {
            const locationsResponse = await fetch(`${API_URL}/get_part_locations?part_id=${partId}`);
            const data = await locationsResponse.json();
            
            if (data.locations.length === 0) {
                aiAdvice.innerHTML += `<br><strong style="color: red;">This part is out of stock everywhere!</strong>`;
                return;
            }

            // Populate the map pins and dropdown
            data.locations.forEach(loc => {
                // Add to dropdown
                const option = document.createElement("option");
                option.value = loc.location;
                option.textContent = `${loc.location} (Qty: ${loc.quantity})`;
                requestSourceSelect.appendChild(option);
                
                // Light up map pin
                const pin = document.getElementById(`pin-${loc.location.replace(" ", "-")}`);
                if (pin) {
                    pin.classList.add("available");
                }
            });

            // Mark the "current" station as red
            const currentPin = document.getElementById(`pin-${requiredAt.replace(" ", "-")}`);
            if (currentPin) {
                currentPin.classList.add("current");
            }

        } catch (error) {
            console.error("Error finding part locations:", error);
            aiAdvice.innerHTML += `<br><strong style="color: red;">Error finding parts.</strong>`;
        }
        
        modalBackdrop.classList.remove("hidden");
    }

    // --- Step 4: Close Modal & Raise Request ---
    closeModal.addEventListener("click", () => {
        modalBackdrop.classList.add("hidden");
    });
    
    raiseRequestBtn.addEventListener("click", (e) => {
        e.preventDefault(); // Stop form from reloading page
        const qty = requestQtyInput.value;
        const source = requestSourceSelect.value;
        alert(`Success!
        
Request raised for ${qty} units
From: ${source}
To: ${document.querySelector(".status-red").dataset.requiredAt}`);
        
        modalBackdrop.classList.add("hidden");
    });
});