import express from "express";
import { ObjectId } from "mongodb";
import db from "../db/config.js";

const router = express.Router();

const usersCollection = db.collection("users");
const discosCollection = db.collection("discos");

// verifica se o ID recebido é um ObjectId válido
function validarId(id) {
    if (!/^[0-9a-fA-F]{24}$/.test(id)) {
        return null;
    }

    return new ObjectId(id);
}

// gera um ID numérico que ainda não existe na coleção
async function gerarId(collection, idsUsados = []) {
    let id;

    do {
        id = Math.floor(Math.random() * 1000000000) + 1;
    } while (
        idsUsados.includes(id) ||
        await collection.findOne({ id: id })
    );

    idsUsados.push(id);
    return id;
}

// prepara um ou vários users antes de os inserir
async function prepararUsers(body) {
    const varios = Array.isArray(body);
    const users = varios ? body : [body];

    if (
        users.length === 0 ||
        users.some(user =>
            !user ||
            typeof user !== "object" ||
            Array.isArray(user) ||
            Object.keys(user).length === 0
        )
    ) {
        return null;
    }

    const idsUsados = [];

    for (const user of users) {
        delete user._id;
        delete user.id;
        delete user.partitionKey;

        user.id = await gerarId(usersCollection, idsUsados);
        user.partitionKey = user.id % 2 === 1 ? 1 : 0;

        if (user.avaliacoes === undefined) {
            user.avaliacoes = [];
        }

        if (!Array.isArray(user.avaliacoes)) {
            throw new Error("O campo avaliacoes deve ser uma lista.");
        }
    }

    return users;
}

// endpoint 2 GET /users
// Lista de users com paginação
router.get("/", async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 20);
        const skip = (page - 1) * limit;

        const results = await usersCollection.find({}).skip(skip).limit(limit).toArray();
        const total = await usersCollection.countDocuments();
        res.status(200).json({ page, limit, total, totalPages: Math.ceil(total / limit), results });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// endpoint 4 POST /users
// Adicionar 1 ou múltiplos Users
router.post("/", async (req, res) => {
    try {
        const users = await prepararUsers(req.body);
        if (!users) {
            return res.status(400).json({ erro: "Envie um User ou 1 lista de Users válida" });
        }

        if (!Array.isArray(req.body)) {
            const result = await usersCollection.insertOne(users[0]);
            return res.status(201).json({ mensagem: "User adicionado com sucesso", insertedId: result.insertedId });
        }

        const result = await usersCollection.insertMany(users);
        res.status(201).json({ mensagem: "Users adicionados com sucesso", insertedCount: result.insertedCount, insertedIds: result.insertedIds });

    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// endpoint 15 POST /users/:id/review/:dataset_id
/* Adicionar uma nova review a um documento.
    :id - user ID;
    :dataset_id – documento ID 
*/
router.post("/:id/review/:dataset_id", async (req, res) => {
    try {
        const userId = validarId(req.params.id);
        const discoId = Number(req.params.dataset_id);

        if (!userId) {
            return res.status(400).json({ erro: "ID do user inválido" });
        }
        if (!Number.isInteger(discoId) || discoId < 1) {
            return res.status(400).json({ erro: "ID do disco inválido" });
        }

        const { nota, comentario, data } = req.body;
        if (!Number.isInteger(nota) || nota < 1 || nota > 5 ||
            typeof comentario !== "string" || comentario.trim() === "") {
            return res.status(400).json({
                erro: "A nota deve estar entre 1 e 5 e o comentário não pode estar vazio"
            });
        }

        const dataReview = data || new Date().toISOString().split("T")[0];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dataReview)) {
            return res.status(400).json({
                erro: "A data deve ter o formato YYYY-MM-DD"
            });
        }

        const user = await usersCollection.findOne({ _id: userId });
        if (!user) {
            return res.status(404).json({ erro: "User não encontrado" });
        }

        const disco = await discosCollection.findOne({ id: discoId });
        if (!disco) {
            return res.status(404).json({ erro: "Disco não encontrado" });
        }

        const review = {
            item_id: discoId,
            nota: nota,
            comentario: comentario.trim(),
            data: dataReview
        };

        await usersCollection.updateOne(
            { _id: userId },
            { $push: { avaliacoes: review } }
        );

        res.status(201).json({ mensagem: "Avaliação adicionada com sucesso", review });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// endpoint 6 GET /users/:id
// Pesquisar user pelo _id. Incluir na resposta o top 3 elementos avaliados do utilizador
router.get("/:id", async (req, res) => {
    try {
        const userId = validarId(req.params.id);
        if (!userId) {
            return res.status(400).json({ erro: "ID do user inválido" });
        }

        const user = await usersCollection.findOne({ _id: userId });
        if (!user) {
            return res.status(404).json({ erro: "User não encontrado" });
        }

        const top3 = [...(user.avaliacoes || [])].sort((a, b) => b.nota - a.nota).slice(0, 3);
        res.status(200).json({
            ...user,
            top_3_avaliacoes: top3
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// endpoint 10 PUT /users/:id
// Update user
router.put("/:id", async (req, res) => {
    try {
        const userId = validarId(req.params.id);
        if (!userId) {
            return res.status(400).json({ erro: "ID do user inválido" });
        }

        const dados = { ...req.body };
        delete dados._id;
        delete dados.id;
        delete dados.partitionKey;

        if (Object.keys(dados).length === 0) {
            return res.status(400).json({ erro: "Não foram enviados dados para atualizar" });
        }

        const result = await usersCollection.updateOne(
            { _id: userId }, 
            { $set: dados }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ erro: "User não encontrado" });
        }
        res.status(200).json({ mensagem: "User atualizado com sucesso" });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// endpoint 8 DELETE /users/:id
// Remover user pelo _id
router.delete("/:id", async (req, res) => {
    try {
        const userId = validarId(req.params.id);
        if (!userId) {
            return res.status(400).json({ erro: "ID do user inválido" });
        }

        const result = await usersCollection.deleteOne({ _id: userId });
        if (result.deletedCount === 0) {
            return res.status(404).json({ erro: "User não encontrado" });
        }
        res.status(200).json({ mensagem: "User apagado com sucesso" });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;