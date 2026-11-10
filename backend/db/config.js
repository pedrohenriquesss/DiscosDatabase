import { MongoClient } from "mongodb";

const connectionString = "mongodb://localhost:27020/";
const client = new MongoClient(connectionString);

let conn;
try {
    conn = await client.connect();
    console.log("Connected to MongoDB");
} catch(e) {
    console.error(e);
}

// Database name
let db = conn.db("project");
export default db;