# 🏆 Judge Walkthrough & Demo Script

Welcome to the **Autonomous TEE Trade Finance Agent** demo guide. This document serves as a step-by-step guide for hackathon judges to verify the project, and a recording script for your demo video.

---

## ⚡ Setup Check (For Judges)
Make sure the server is running locally and the Stripe dashboard is open in Test Mode.
* **App Console**: `http://localhost:3000`
* **Stripe Payments**: `https://dashboard.stripe.com/test/payments`
* **Stripe Connected Accounts**: `https://dashboard.stripe.com/test/connect/accounts`

---

## 🎙️ Demo Script & Storyboard

This script aligns your screen recording with the security events happening under the hood.

### **Step 1: Introduction & Dashboard Overview**
* **Visual**: Show the running dashboard at `http://localhost:3000`. Hover over the three sections: **Letters of Credit**, the **TEE Agent Logs**, and the **Cryptographic Audit Ledger**.
* **Voiceover / Script**:
  > *"Welcome. This is our Autonomous Trade Finance Agent. It automates Letter of Credit (LC) escrows while guaranteeing that sensitive payment keys and destination accounts are shielded inside a Trusted Execution Environment (TEE). Let's walk through our 4-click happy path."*

---

### **Step 2: Escrow Hold Authorization (Click 1 & 2)**
* **Visual**: Click on the first Letter of Credit card (Rotterdam, Acme Textiles). Click the emerald **Authorize Escrow** button.
* **Voiceover / Script**:
  > *"First, we select the Rotterdam LC. Clicking 'Authorize Escrow' simulates the buyer signing a delegation credential in their browser. Under the hood, the Terminal 3 SDK mints an EIP-191 signed credential and places an authorization hold on the buyer's card."*

* **Visual**: Switch tabs to the **Stripe Dashboard (Payments)**. Refresh to show the new **AUD $25,000.00** payment in **Uncaptured** state.
* **Voiceover / Script**:
  > *"If we check our Stripe Test Dashboard, we see a new $25,000 AUD payment created. It is marked as 'Uncaptured'. The funds are locked in escrow, and have not yet been released to the exporter."*

---

### **Step 3: Simulate Port Delivery & TEE Execution (Click 3)**
* **Visual**: Switch back to the app console. Click **Simulate Port Delivery**. Point to the streaming logs inside the TEE panel.
* **Voiceover / Script**:
  > *"Next, we click 'Simulate Port Delivery' to fire a mock logistics webhook. Watch the live agent logs stream: first, the agent's DID identity is verified. Second, Google Gemini parses the unstructured logistics webhook. Third, the deterministic policy gate checks the delivery details against contract terms. Finally, the agent executes the payout."*

* **Visual**: Switch to the **Stripe Dashboard (Payments)**. Show that the payment has transitioned to **Succeeded**. Then switch to the **Connected Accounts** tab and open `acct_1TirxA8iGRP26vX8` to show the transfer.
* **Voiceover / Script**:
  > *"In our Stripe dashboard, refreshing the payment shows it has transitioned to 'Succeeded'. Looking at Connected Accounts, the payout has been successfully transferred directly to the exporter's connected account on-the-fly. The agent did this without exposing any secret API keys to the client or the database."*

---

### **Step 4: Inspect Enclave Proof & Hash Chain (Click 4)**
* **Visual**: Scroll down to the **Audit Ledger** at the bottom of the app console. Click the **Inspect** button next to the `SETTLED` state transition.
* **Visual**: Toggle the drawer to the **Raw Cryptography Payload** tab, highlighting the JSON and signatures.
* **Voiceover / Script**:
  > *"Finally, we click 'Inspect' on the ledger row. The Cryptographic Drawer displays the EIP-191 signatures, the parsed LLM advice, and the raw receipt hash generated inside the enclave. Every step is signed by the Agent DID, creating an immutable audit trail."*

---

### **Step 5: CLI Verification (Optional / Extra)**
* **Visual**: Open the terminal window next to the browser and run the audit verification tool:
  ```bash
  npm run audit:verify
  ```
* **Voiceover / Script**:
  > *"We can verify the integrity of this audit trail on the command line. Running our audit verification tool computes a rolling SHA-256 hash chain over the database rows, validating that no database tampering occurred outside the enclave."*

---

### **Step 6: Policy Denials (Port Mismatch & Over Value)**
* **Visual**: Go back to the dashboard. Select the **Port Mismatch** LC (required port Hamburg, cargo targeted Rotterdam) or the **Over Value** LC (exceeds cap). Click **Authorize** and then **Simulate Port Delivery**.
* **Visual**: Point out the orange logs showing the policy gate rejecting the release and marking it as **DENIED**.
* **Voiceover / Script**:
  > *"To show the safety of our policy gate, let's select the Port Mismatch LC. When we simulate delivery, the deterministic policy engine rejects the release because the target port does not match contract terms. No Stripe capture or transfer is executed, and a 'DENIED' receipt is written to the ledger."*

---

### **Step 7: Conclusion**
* **Visual**: Show the full dashboard interface.
* **Voiceover / Script**:
  > *"By combining the Terminal 3 Agent Auth SDK for secure key handling, Google Gemini for document parsing, and deterministic code for policy execution, we have built a secure, fully automated, and auditable trade finance pipeline. Thank you."*

---

## 🛠️ Summary of Interactive Features to Highlight

| Feature | What It Demonstrates | How to Show It |
| --- | --- | --- |
| **TEE Agent Logs** | Real-time enclave execution | Watch the logs stream in green when you click "Simulate Port Delivery". |
| **Live Stripe Hook** | Integration with production APIs | Show the PaymentIntent change from *Uncaptured* to *Succeeded* in Stripe. |
| **Stripe Connect** | Shielded destination routing | Show the Transfer reaching the Connected Account (`acct_...`). |
| **Cryptographic Drawer** | Zero-trust proofs and signatures | Click "Inspect" to show the raw JSON, agent signatures, and enclaves receipt hashes. |
| **Heuristics / Policy Split** | LLM parsing with code-level safety | Show the LLM's explanation in the drawer alongside the strict code rules. |
| **Audit CLI** | Git-style rolling block hash chain | Run `npm run audit:verify` in the terminal to show chain integrity validation. |
