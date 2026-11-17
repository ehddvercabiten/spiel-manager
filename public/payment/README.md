# GCash QR placeholder

The file `public/payment/gcash-qr-placeholder.png` is a non-payment demo QR. It encodes only a text string identifying it as a demo; it is NOT connected to GCash and cannot receive money.

## Replacing it with your real QR
1. Obtain a QR code for a receiving account that is authorized for the intended subscription/commercial use.
2. Save a clear PNG image.
3. Replace `public/payment/gcash-qr-placeholder.png` with your image, keeping the same filename.
4. Rebuild and redeploy the frontend.
5. Test by scanning the displayed QR and confirming the recipient name and amount before sending any payment.

Do not publish a personal GCash QR for business collections unless GCash has confirmed that use is permitted.
