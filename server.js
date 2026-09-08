import express from "express";
import cors from "cors";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const APP_TYPE = "juriscoach";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", app: APP_TYPE });
});

app.post("/api/juriscoach/consult", async (req, res) => {
  const { question } = req.body;
  res.json({
    question,
    advice: "Consultez un avocat pour aide personnalisée",
    cost: "50,000 - 200,000 FCFA"
  });
});

app.get("/api/juriscoach/jurisprudence", async (req, res) => {
  res.json({ cases: [] });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`JurisCoach running on ${PORT}`);
});

export { app, pool };
