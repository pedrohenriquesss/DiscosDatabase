import express from "express";
import db from "../db/config.js";
import { ObjectId } from "mongodb";

const router = express.Router();

// endpoint 1 GET /discos
// Lista todos os documentos com paginação
router.get("/", async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 20);
        const skip = (page - 1) * limit;

        const results = await db.collection("discos")
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

// endpoint 5 GET /discos
// Pesquisar documento pelo _id (incluir toda a informação do documento e o average score)
router.get("/:id", async (req, res) => {
    try {
        const id = req.params.id;

        // Verificar se o ID tem o formato de um ObjectId
        if (!/^[0-9a-fA-F]{24}$/.test(id)) {
            return res.status(400).json({
                error: "Invalid MongoDB ObjectId"
            });
        }

        // Procurar o disco pelo _id
        const disco = await db.collection("discos").findOne({
            _id: new ObjectId(id)
        });

        // Verificar se o disco existe
        if (!disco) {
            return res.status(404).json({
                error: "Disco not found"
            });
        }

        // Procurar as avaliações deste disco na coleção users
        const ratings = await db.collection("users").aggregate([
            {
                $unwind: "$avaliacoes"
            },
            {
                $match: {
                    "avaliacoes.item_id": disco.id
                }
            },
            {
                $group: {
                    _id: null,
                    averageScore: {
                        $avg: "$avaliacoes.nota"
                    },
                    totalReviews: {
                        $sum: 1
                    }
                }
            }
        ]).toArray();

        // Obter a média e o número de avaliações
        const averageScore = ratings.length > 0
            ? ratings[0].averageScore
            : null;

        const totalReviews = ratings.length > 0
            ? ratings[0].totalReviews
            : 0;

        // Devolver o disco com a média das avaliações
        res.status(200).json({
            ...disco,
            averageScore,
            totalReviews
        });

    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});

export default router;