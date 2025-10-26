import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// --- Health Check ---
app.get("/", (req, res) => {
  res.send("✅ ScaryFast Shopify App is live and ready.");
});

// --- Update product images ---
app.post("/update-images", async (req, res) => {
  try {
    const { productIds } = req.body;

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ error: "No product IDs provided." });
    }

    const domain = process.env.SHOPIFY_STORE_DOMAIN;
    const token = process.env.SHOPIFY_ACCESS_TOKEN;

    if (!domain || !token) {
      return res.status(500).json({
        error: "Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ACCESS_TOKEN environment variables.",
      });
    }

    const updated = [];

    for (const id of productIds) {
      console.log(`🛠️ Updating product ID: ${id}`);

      // Fetch product info
      const { data } = await axios.get(
        `https://${domain}/admin/api/2024-07/products/${id}.json`,
        {
          headers: {
            "X-Shopify-Access-Token": token,
            "Content-Type": "application/json",
          },
        }
      );

      const product = data.product;
      if (!product) continue;

      const title = product.title || "Unnamed Product";
      const newImage = `https://via.placeholder.com/800x800.png?text=${encodeURIComponent(title)}`;

      // Update Shopify product image
      await axios.put(
        `https://${domain}/admin/api/2024-07/products/${id}.json`,
        {
          product: {
            id,
            images: [{ src: newImage }],
          },
        },
        {
          headers: {
            "X-Shopify-Access-Token": token,
            "Content-Type": "application/json",
          },
        }
      );

      updated.push({ id, title, image: newImage });
      console.log(`✅ Updated ${title}`);
    }

    res.json({ success: true, updated });
  } catch (error) {
    console.error("❌ Error in /update-images:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// --- Health Route ---
app.get("/health", (req, res) => res.send("OK"));

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
