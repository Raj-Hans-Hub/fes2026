import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import chokidar from 'chokidar';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import * as diff from 'diff';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '100mb' }));

const server = createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const WATCH_DIR = path.join(__dirname, 'my-monitor-folder');
const TRASH_DIR = path.join(__dirname, '.trash_bin');

if (!fs.existsSync(WATCH_DIR)) fs.mkdirSync(WATCH_DIR);
if (!fs.existsSync(TRASH_DIR)) fs.mkdirSync(TRASH_DIR);

const MONGO_URI = 'mongodb://127.0.0.1:27017/file_monitor_db';
mongoose.connect(MONGO_URI)
    .then(() => { console.log("🔌 Database Online"); runStartupSync(); })
    .catch(err => console.error("Database Link Failure:", err));

const LogSchema = new mongoose.Schema({ time: String, action: String, message: String, details: String, timestamp: { type: Date, default: Date.now } });
const DeletedFileSchema = new mongoose.Schema({ originalName: String, deletedAt: String, fileData: String, isBinary: Boolean, timestamp: { type: Date, default: Date.now } });
const LockedFileSchema = new mongoose.Schema({ fileName: { type: String, unique: true }, fileData: String, isBinary: Boolean });
const HiddenFileSchema = new mongoose.Schema({ fileName: { type: String, unique: true } });

const LogModel = mongoose.model('Log', LogSchema);
const DeletedFileModel = mongoose.model('DeletedFile', DeletedFileSchema);
const LockedFileModel = mongoose.model('LockedFile', LockedFileSchema);
const HiddenFileModel = mongoose.model('HiddenFile', HiddenFileSchema);

const fileCache = new Map();
let renameQueue = new Map();
let rollbackInProgress = false;
async function addLog(action, message, details = null) {
    const timeStr = new Date().toLocaleTimeString();
    const newLog = new LogModel({ time: timeStr, action, message, details });
    await newLog.save();
    io.emit('new-log', { id: newLog._id, time: timeStr, action, message, details });
}

function checkIsBinary(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    return !['.txt', '.html', '.css', '.js', '.json', '.md', '.csv'].includes(ext);
}

function applyWindowsOSLock(filePath, shouldLock) {
    try {
        if (shouldLock) {
            execSync(`icacls "${filePath}" /deny Everyone:(R,W,D,WDAC,REA,WEA)`);
        } else {
            execSync(`icacls "${filePath}" /remove:d Everyone`);
        }
    } catch (e) {}
}

function applyWindowsStealthHide(filePath, shouldHide) {
    try {
        if (shouldHide) {
            execSync(`attrib +h +s "${filePath}"`);
        } else {
            execSync(`attrib -h -s "${filePath}"`);
        }
    } catch (e) {}
}

async function runStartupSync() {
    console.log("🔍 System Boot Check: Validating Integrity...");
    rollbackInProgress = true;
    try {
        const dbLockedFiles = await LockedFileModel.find({});
        for(let f of dbLockedFiles) { applyWindowsOSLock(path.join(WATCH_DIR, f.fileName), false); }
        
        const actualFiles = fs.readdirSync(WATCH_DIR);
        for (let lockedFile of dbLockedFiles) {
            if (!lockedFile.fileData) continue;
            const targetPath = path.join(WATCH_DIR, lockedFile.fileName);
            
            if (!actualFiles.includes(lockedFile.fileName)) {
                fs.writeFileSync(targetPath, Buffer.from(lockedFile.fileData, 'base64'));
                await addLog('SECURITY_ALERT', `[Self Healing] Restored missing secure file: "${lockedFile.fileName}"`);
            } else {
                const currentBase64 = fs.readFileSync(targetPath).toString('base64');
                if (currentBase64 !== lockedFile.fileData) {
                    fs.writeFileSync(targetPath, Buffer.from(lockedFile.fileData, 'base64'));
                    await addLog('SECURITY_ALERT', `[Self Healing] Rolled back tempering on: "${lockedFile.fileName}"`);
                }
            }
            applyWindowsOSLock(targetPath, true);
        }
        
        const dbHides = await HiddenFileModel.find({});
        for(let hFile of dbHides) { applyWindowsStealthHide(path.join(WATCH_DIR, hFile.fileName), true); }
        
    } catch (err) { console.error("Integrity Sync Failure:", err); }
    setTimeout(() => { rollbackInProgress = false; }, 500);
}
const watcher = chokidar.watch(WATCH_DIR, {
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }
});

watcher
    .on('add', async (filePath) => {
        if (rollbackInProgress) return;
        const fileName = path.basename(filePath);
        const now = Date.now();
        try { if (fs.statSync(filePath).isFile()) fileCache.set(filePath, fs.readFileSync(filePath).toString('base64')); } catch (e) {}

        let possibleOldFile = null;
        for (let [oldName, deleteTime] of renameQueue.entries()) {
            if (now - deleteTime < 400) { possibleOldFile = oldName; break; }
        }

        if (possibleOldFile) {
            renameQueue.delete(possibleOldFile);
            const isLocked = await LockedFileModel.findOne({ fileName: possibleOldFile });
            if (isLocked) {
                rollbackInProgress = true;
                try {
                    const oldPath = path.join(WATCH_DIR, possibleOldFile);
                    fs.writeFileSync(oldPath, Buffer.from(isLocked.fileData, 'base64'));
                    applyWindowsOSLock(oldPath, true);
                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                    await addLog('SECURITY_ALERT', `Intrusion Prevented! Rename blocked on locked item: "${possibleOldFile}"`);
                } catch (err) {}
                setTimeout(() => { rollbackInProgress = false; }, 400);
                return;
            }
            await DeletedFileModel.deleteOne({ originalName: possibleOldFile });
            const updatedTrash = await DeletedFileModel.find({}).sort({ timestamp: -1 }).limit(50);
            io.emit('deleted-list-update', updatedTrash.map(d => ({ id: d._id, originalName: d.originalName, deletedAt: d.deletedAt })));
            await addLog('RENAME', `Item renamed from "${possibleOldFile}" to "${fileName}"`);
            return;
        }
        await addLog('CREATE', `Item generated: "${fileName}"`);
    })
    .on('change', async (filePath) => {
        if (rollbackInProgress) return;
        const fileName = path.basename(filePath);
        const isLocked = await LockedFileModel.findOne({ fileName });
        if (isLocked) {
            rollbackInProgress = true;
            try {
                applyWindowsOSLock(filePath, false);
                fs.writeFileSync(filePath, Buffer.from(isLocked.fileData, 'base64'));
                applyWindowsOSLock(filePath, true);
                await addLog('SECURITY_ALERT', `Tampering Halted! Direct write block on: "${fileName}"`);
            } catch (err) {}
            setTimeout(() => { rollbackInProgress = false; }, 400);
            return;
        }
        try {
            if (!fs.statSync(filePath).isFile()) return;
            const oldBase64 = fileCache.get(filePath) || "";
            const newBuffer = fs.readFileSync(filePath);
            const newBase64 = newBuffer.toString('base64');
            if (oldBase64 !== newBase64) {
                if (!checkIsBinary(fileName)) {
                    const differences = diff.diffLines(Buffer.from(oldBase64, 'base64').toString('utf-8'), newBuffer.toString('utf-8'));
                    let changes = [];
                    differences.forEach(part => { if (part.added) changes.push(`[+] ${part.value.trim()}`); else if (part.removed) changes.push(`[-] ${part.value.trim()}`); });
                    if (changes.length > 0) await addLog('MODIFY', `Payload modified in: "${fileName}"`, changes.join(' | '));
                } else {
                    await addLog('MODIFY', `Binary signature changed in: "${fileName}"`);
                }
                fileCache.set(filePath, newBase64);
            }
        } catch (err) {}
    })
    .on('unlink', async (filePath) => {
        if (rollbackInProgress) return;
        const fileName = path.basename(filePath);
        const cachedData = fileCache.get(filePath) || "";
        fileCache.delete(filePath);
        renameQueue.set(fileName, Date.now());
        setTimeout(async () => {
            if (renameQueue.has(fileName)) {
                renameQueue.delete(fileName);
                const isLocked = await LockedFileModel.findOne({ fileName });
                if (isLocked) {
                    rollbackInProgress = true;
                    try {
                        fs.writeFileSync(filePath, Buffer.from(isLocked.fileData, 'base64'));
                        applyWindowsOSLock(filePath, true);
                        await addLog('SECURITY_ALERT', `Deletion Intercepted! Safeguarded: "${fileName}"`);
                    } catch (err) {}
                    setTimeout(() => { rollbackInProgress = false; }, 400);
                    return;
                }
                const deletedItem = new DeletedFileModel({ originalName: fileName, deletedAt: new Date().toLocaleTimeString(), fileData: cachedData, isBinary: checkIsBinary(fileName) });
                await deletedItem.save();
                const updatedTrash = await DeletedFileModel.find({}).sort({ timestamp: -1 }).limit(50);
                io.emit('deleted-list-update', updatedTrash.map(d => ({ id: d._id, originalName: d.originalName, deletedAt: d.deletedAt })));
                await addLog('DELETE', `Item wiped out: "${fileName}"`);
            }
        }, 300);
    });
app.get('/api/data', async (req, res) => {
    try {
        const logs = await LogModel.find({}).sort({ timestamp: -1 }).limit(100);
        const deletedFiles = await DeletedFileModel.find({}).sort({ timestamp: -1 }).limit(50);
        const dbLocks = await LockedFileModel.find({});
        const dbHides = await HiddenFileModel.find({});
        let activeFiles = [];
        try { activeFiles = fs.readdirSync(WATCH_DIR).filter(file => fs.statSync(path.join(WATCH_DIR, file)).isFile()); } catch(e){}
        res.json({ 
            logs: logs.map(l => ({ id: l._id, time: l.time, action: l.action, message: l.message, details: l.details })), 
            deletedFiles: deletedFiles.map(d => ({ id: d._id, originalName: d.originalName, deletedAt: d.deletedAt })), 
            activeFiles, 
            lockedFiles: dbLocks.map(f => f.fileName),
            hiddenFiles: dbHides.map(f => f.fileName)
        });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/toggle-lock', async (req, res) => {
    const { fileName } = req.body;
    const filePath = path.join(WATCH_DIR, fileName);
    if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, message: "Missing target" });
    try {
        const existingLock = await LockedFileModel.findOne({ fileName });
        if (existingLock) {
            applyWindowsOSLock(filePath, false);
            await LockedFileModel.deleteOne({ fileName });
            await addLog('UNLOCK', `Decryption Key Injection Successful: "${fileName}"`);
        } else {
            const fileBuffer = fs.readFileSync(filePath);
            const newLock = new LockedFileModel({ fileName, fileData: fileBuffer.toString('base64'), isBinary: checkIsBinary(fileName) });
            await newLock.save();
            applyWindowsOSLock(filePath, true);
            await addLog('LOCK', `Quantum Encryption Matrix Applied: "${fileName}"`);
        }
        const dbLocks = await LockedFileModel.find({});
        io.emit('lock-status-update', dbLocks.map(f => f.fileName));
        res.json({ success: true, lockedFiles: dbLocks.map(f => f.fileName) });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/toggle-visibility', async (req, res) => {
    const { fileName } = req.body;
    const filePath = path.join(WATCH_DIR, fileName);
    const isLocked = await LockedFileModel.findOne({ fileName });
    if (isLocked) applyWindowsOSLock(filePath, false);
    try {
        const existingHide = await HiddenFileModel.findOne({ fileName });
        if (existingHide) {
            applyWindowsStealthHide(filePath, false);
            await HiddenFileModel.deleteOne({ fileName });
            await addLog('SHOW', `Stealth Mode Deactivated for: "${fileName}"`);
        } else {
            applyWindowsStealthHide(filePath, true);
            const newHide = new HiddenFileModel({ fileName });
            await newHide.save();
            await addLog('HIDE', `Stealth Cloaking Engine Engaged on: "${fileName}"`);
        }
        if (isLocked) applyWindowsOSLock(filePath, true);
        const dbHides = await HiddenFileModel.find({});
        io.emit('hidden-status-update', dbHides.map(f => f.fileName));
        res.json({ success: true });
    } catch (err) { 
        if (isLocked) applyWindowsOSLock(filePath, true);
        res.status(500).json({ success: false, message: err.message }); 
    }
});

app.post('/api/restore', async (req, res) => {
    const { id } = req.body;
    try {
        const fileToRestore = await DeletedFileModel.findById(id);
        if (!fileToRestore) return res.status(404).json({ success: false, message: "Vault sector missing" });
        const destinationPath = path.join(WATCH_DIR, fileToRestore.originalName);
        rollbackInProgress = true;
        fs.writeFileSync(destinationPath, Buffer.from(fileToRestore.fileData, 'base64'));
        await DeletedFileModel.findByIdAndDelete(id);
        const deletedFiles = await DeletedFileModel.find({}).sort({ timestamp: -1 }).limit(50);
        io.emit('deleted-list-update', deletedFiles.map(d => ({ id: d._id, originalName: d.originalName, deletedAt: d.deletedAt })));
        await addLog('RESTORE', `Data Fragment Reassembled: "${fileToRestore.originalName}"`);
        setTimeout(() => { rollbackInProgress = false; }, 400);
        res.json({ success: true });
    } catch (error) { rollbackInProgress = false; res.status(500).json({ success: false, message: error.message }); }
});

const PORT = 5000;
server.listen(PORT, () => { console.log(`🚀 Cyber Core Live on port ${PORT}`); });
