import express from 'express'
import users from "./routes/users.js";
import discos from "./routes/discos.js";

const app = express()
const port = 3000

app.use(express.json());

app.use("/users", users);
app.use("/discos", discos);

app.use((req, res) => {
    res.status(404).json({ erro: "Endpoint não encontrado" });
});

app.listen(port, () => {
 console.log(`backend listening on port ${port}`)
})