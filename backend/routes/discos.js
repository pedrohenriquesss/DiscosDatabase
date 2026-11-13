import express from "express";
import { ObjectId } from "mongodb";
import db from "../db/config.js";

const router = express.Router();

const discosCollection = db.collection("discos");
const usersCollection = db.collection("users");

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

// prepara 1 ou mais discos antes de os inserir
async function prepararDiscos(body) {
    const varios = Array.isArray(body);
    const discos = varios ? body : [body];

    if (
        discos.length === 0 ||
        discos.some(disco =>
            !disco || typeof disco !== "object" ||
            Array.isArray(disco) || Object.keys(disco).length === 0)
    ) {
        return null;
    }

    const idsUsados = [];
    for (const disco of discos) {
        delete disco._id;
        delete disco.id;
        delete disco.partitionKey;

        disco.id = await gerarId(discosCollection, idsUsados);
        disco.partitionKey = disco.id % 2 === 1 ? 1 : 0;
    }

    return discos;
}

// endpoint 1 GET /discos
// Lista todos os documentos com paginação
router.get("/", async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 20);
        const skip = (page - 1) * limit;

        const results = await discosCollection.find({}).skip(skip).limit(limit).toArray();
        const total = await discosCollection.countDocuments();

        res.status(200).json({ page, limit, total, totalPages: Math.ceil(total / limit), results });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// endpoint 3 POST /discos
// Adicionar 1 ou múltiplos elementos
router.post("/", async (req, res) => {
    try {
        const discos = await prepararDiscos(req.body);
        if (!discos) {
            return res.status(400).json({
                erro: "Envie um disco ou uma lista de discos válida"
            });
        }

        if (!Array.isArray(req.body)) {
            const result = await discosCollection.insertOne(discos[0]);
            return res.status(201).json({ mensagem: "Disco adicionado com sucesso", insertedId: result.insertedId });
        }

        const result = await discosCollection.insertMany(discos);
        res.status(201).json({ mensagem: "Discos adicionados com sucesso",
            insertedCount: result.insertedCount, insertedIds: result.insertedIds });

    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// endpoint 11 GET /discos/top/:limit
// Top discos por média das avaliações
/* Lista de documentos com maior score (pela média), por ordem descendente. 
Mostrar na resposta toda a informação do dataset. Limitar o total de documentos na resposta por {limit} 
*/
router.get("/top/:limit", async (req, res) => {
    try {
        const topLimit = Number(req.params.limit);
        if (!Number.isInteger(topLimit) || topLimit < 1) {
            return res.status(400).json({ erro: "O limite deve ser um inteiro positivo." });
        }

        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 20);
        const skip = (page - 1) * limit;

        const results = await discosCollection.aggregate([
            {
                $lookup: {
                    from: "users",
                    let: { discoId: "$id" },
                    pipeline: [
                        { $unwind: "$avaliacoes" },
                        {
                            $match: {
                                $expr: {
                                    $eq: ["$avaliacoes.item_id", "$$discoId"]
                                }
                            }
                        }
                    ],
                    as: "todas_avaliacoes"
                }
            },
            {
                $addFields: {
                    average_score: {
                        $ifNull: [
                            { $avg: "$todas_avaliacoes.avaliacoes.nota" },
                            0
                        ]
                    }
                }
            },
            { $sort: { average_score: -1 } },
            { $project: { todas_avaliacoes: 0 } }
        ]).toArray();

        const topDiscos = results.slice(0, topLimit);
        const paginatedResults = topDiscos.slice(skip, skip + limit);

        res.status(200).json({ page, limit, total: topDiscos.length, totalPages: Math.ceil(topDiscos.length / limit), results: paginatedResults });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// endpoint 12 GET /discos/ratings/:order
// Lista de documentos ordenado pelo número total de avaliações
// :order - “asc” or “desc”
router.get("/ratings/:order", async (req, res) => {
    try {
        const order = req.params.order.toLowerCase();
        if (order !== "asc" && order !== "desc") {
            return res.status(400).json({ erro: "A ordenação deve ser asc ou desc." });
        }

        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 20);
        const skip = (page - 1) * limit;

        const results = await discosCollection.aggregate([
            {
                $lookup: {
                    from: "users",
                    let: { discoId: "$id" },
                    pipeline: [
                        { $unwind: "$avaliacoes" },
                        {
                            $match: {
                                $expr: {
                                    $eq: ["$avaliacoes.item_id", "$$discoId"]
                                }
                            }
                        }
                    ],
                    as: "todas_avaliacoes"
                }
            },
            {
                $addFields: {
                    total_ratings: { $size: "$todas_avaliacoes" }
                }
            },
            { $sort: { total_ratings: order === "asc" ? 1 : -1 } },
            { $project: { todas_avaliacoes: 0 } }
        ]).toArray();

        res.status(200).json({ page, limit, total: results.length, totalPages: Math.ceil(results.length / limit), results: results.slice(skip, skip + limit) });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// endpoint 13 GET /discos/star
// Lista de documentos com mais 5 estrelas. Mostrar toda a informação do dataset
router.get("/star", async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 20);
        const skip = (page - 1) * limit;

        const results = await discosCollection.aggregate([
            {
                $lookup: {
                    from: "users",
                    let: { discoId: "$id" },
                    pipeline: [
                        { $unwind: "$avaliacoes" },
                        {
                            $match: {
                                $expr: {
                                    $eq: ["$avaliacoes.item_id", "$$discoId"]
                                },
                                "avaliacoes.nota": 5
                            }
                        }
                    ],
                    as: "avaliacoes_5_estrelas"
                }
            },
            {
                $addFields: {
                    total_5_estrelas: { $size: "$avaliacoes_5_estrelas" }
                }
            },
            { $sort: { total_5_estrelas: -1 } },
            { $project: { avaliacoes_5_estrelas: 0 } }
        ]).toArray();

        res.status(200).json({ page, limit, total: results.length, totalPages: Math.ceil(results.length / limit), results: results.slice(skip, skip + limit) });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// endpoint 14 GET /discos/:year
// Lista de documentos avaliados no ano {year}
router.get("/:year", async (req, res) => {
    try {
        const year = req.params.year;

        if (!/^\d{4}$/.test(year)) {
            return res.status(400).json({ erro: "O ano deve ter quatro algarismos." });
        }

        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 20);
        const skip = (page - 1) * limit;

        const results = await discosCollection.aggregate([
            {
                $lookup: {
                    from: "users",
                    let: { discoId: "$id" },
                    pipeline: [
                        { $unwind: "$avaliacoes" },
                        {
                            $match: {
                                $expr: {
                                    $eq: ["$avaliacoes.item_id", "$$discoId"]
                                },
                                "avaliacoes.data": { $regex: `^${year}-` }
                            }
                        }
                    ],
                    as: "avaliacoes_ano"
                }
            },
            { $match: { "avaliacoes_ano.0": { $exists: true } } },
            { $project: { avaliacoes_ano: 0 } }
        ]).toArray();

        res.status(200).json({ page, limit, total: results.length, totalPages: Math.ceil(results.length / limit), results: results.slice(skip, skip + limit) });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// endpoint extra
// GET /discos/pesquisa/genero/:genero
// Pesquisar discos por género
router.get("/pesquisa/genero/:genero", async (req, res) => {
    try {
        const genero = req.params.genero.trim();
        if (genero === "") {
            return res.status(400).json({ erro: "O género é obrigatório." });
        }

        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 20);
        const skip = (page - 1) * limit;

        const filtro = {
            genero: {
                $regex: `^${genero}$`,
                $options: "i"
            }
        };

        const results = await discosCollection.find(filtro).skip(skip).limit(limit).toArray();
        const total = await discosCollection.countDocuments(filtro);

        res.status(200).json({ page, limit, total, totalPages: Math.ceil(total / limit), results });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// endpoint extra 
// GET /discos/pesquisa/formato/:formato
// Pesquisar por formato (vinil, cd, etc) e calcular preço médio
router.get("/pesquisa/formato/:formato", async (req, res) => {
    try {
        const formato = req.params.formato.trim();
        if (formato === "") {
            return res.status(400).json({ erro: "O formato é obrigatório." });
        }

        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 20);
        const skip = (page - 1) * limit;

        const resultado = await discosCollection.aggregate([
            {
                $match: {
                    formato: {
                        $regex: `^${formato}$`,
                        $options: "i"
                    }
                }
            },
            {
                $group: {
                    _id: "$formato",
                    total_discos: { $sum: 1 },
                    preco_medio_eur: { $avg: "$preco_eur" },
                    discos: { $push: "$$ROOT" }
                }
            }
        ]).toArray();

        if (resultado.length === 0) {
            return res.status(404).json({ erro: "Não foram encontrados discos com esse formato." });
        }

        const grupo = resultado[0];

        res.status(200).json({
            formato: grupo._id, total_discos: grupo.total_discos,
            preco_medio_eur: Number((grupo.preco_medio_eur || 0).toFixed(2)), page, limit,
            totalPages: Math.ceil(grupo.total_discos / limit), results: grupo.discos.slice(skip, skip + limit) });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// endpoint extra
// GET /discos/estatisticas/estado
// Quantidade de discos por estado
router.get("/estatisticas/estado", async (req, res) => {
    try {
        const results = await discosCollection.aggregate([
            {
                $group: {
                    _id: "$estado",
                    total: { $sum: 1 }
                }
            },
            { $sort: { total: -1 } }
        ]).toArray();

        res.status(200).json(results);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// endpoint extra
// POST /discos/desconto
// Aplicar desconto aos discos lançados antes de determinado ano
router.post("/desconto", async (req, res) => {
    try {
        const { ano, percentagem } = req.body;
        if (
            !Number.isInteger(ano) || ano < 1 || typeof percentagem !== "number" ||
            !Number.isFinite(percentagem) || percentagem <= 0 || percentagem >= 100
        ) {
            return res.status(400).json({
                erro: "Indique um ano válido e uma percentagem entre 0 e 100."
            });
        }

        const multiplicador = 1 - (percentagem / 100);
        const result = await discosCollection.updateMany(
            { ano_lancamento: { $lt: ano } },
            { $mul: { preco_eur: multiplicador } }
        );

        res.status(200).json({ mensagem: `Desconto de ${percentagem}% aplicado com sucesso.`, discos_atualizados: result.modifiedCount });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// endpoint 5 GET /discos/:id
// Pesquisar documento pelo _id. Resposta deverá incluir toda a informação do documento e o average score 
router.get("/:id", async (req, res) => {
    try {
        const discoId = validarId(req.params.id);
        if (!discoId) {
            return res.status(400).json({ erro: "ID do disco inválido" });
        }

        const disco = await discosCollection.findOne({ _id: discoId });
        if (!disco) {
            return res.status(404).json({ erro: "Disco não encontrado" });
        }

        const users = await usersCollection.find({
            "avaliacoes.item_id": disco.id
        }).toArray();

        let somaNotas = 0;
        let totalAvaliacoes = 0;

        users.forEach(user => {
            (user.avaliacoes || []).forEach(avaliacao => {
                if (avaliacao.item_id === disco.id) {
                    somaNotas += avaliacao.nota;
                    totalAvaliacoes++;
                }
            });
        });

        const averageScore = totalAvaliacoes > 0 ? Number((somaNotas / totalAvaliacoes).toFixed(2)) : 0;
        res.status(200).json({ ...disco, average_score: averageScore, total_avaliacoes: totalAvaliacoes });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ---------------------------------------------------------
// endpoint 9 PUT /discos/:id
// Update disco
router.put("/:id", async (req, res) => {
    try {
        const discoId = validarId(req.params.id);
        if (!discoId) {
            return res.status(400).json({ erro: "ID do disco inválido" });
        }

        const dados = { ...req.body };
        delete dados._id;
        delete dados.id;
        delete dados.partitionKey;

        if (Object.keys(dados).length === 0) {
            return res.status(400).json({ erro: "Não foram enviados dados para atualizar" });
        }

        const result = await discosCollection.updateOne(
            { _id: discoId },
            { $set: dados }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ erro: "Disco não encontrado" });
        }

        res.status(200).json({ mensagem: "Disco atualizado com sucesso" });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// endpoint 7 DELETE /discos/:id
// Remover documento pelo _id
router.delete("/:id", async (req, res) => {
    try {
        const discoId = validarId(req.params.id);
        if (!discoId) {
            return res.status(400).json({ erro: "ID do disco inválido" });
        }

        const result = await discosCollection.deleteOne({ _id: discoId });
        if (result.deletedCount === 0) {
            return res.status(404).json({ erro: "Disco não encontrado" });
        }

        res.status(200).json({ mensagem: "Disco apagado com sucesso" });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;