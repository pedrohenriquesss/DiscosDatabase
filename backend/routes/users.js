import express from "express";
import db from "../db/config.js";

const router = express.Router();

// endpoint 2 GET /users
// Lista de users com paginação
router.get("/", async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 20);
        const skip = (page - 1) * limit;

        const results = await db.collection("users")
            .find({})
            .skip(skip)
            .limit(limit)
            .toArray();

        res.status(200).json({
            page,
            limit,
            results
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;