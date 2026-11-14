# Totem

## Introduction

Totem turns your allergies, medications, conditions and emergency contacts into a small QR code. A first responder
scans it with any phone camera and sees your card in large, high-contrast text. The data is compressed with a hash
table and Huffman coding so the QR code stays small and easy to scan, and it never leaves your device until you share
the code.

## How to use

1. Install and start the app:

   ```bash
   npm install
   ```

   ```bash
   npm run dev
   ```

2. Open http://localhost:5173/generator/ in your browser.
3. Under **Medical cases**, tap **Add a case**, choose a type, start typing a name and pick a suggestion, then add a
   dose or severity.
4. Under **Emergency contacts**, tap **Add a contact** and enter a name, phone number and relation.
5. Tap **Generate QR code**. Download it to print on a wallet card or set as your lock screen.
6. Scan the code with a phone camera to see the emergency card. To test from a phone, open the generator through
   the "Network" address that `npm run dev` prints, so the phone and computer are on the same Wi-Fi.
