import React, { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

const socket = io('http://localhost:5000');

function App() {
  const [logs, setLogs] = useState([]);
  const [deletedFiles, setDeletedFiles] = useState([]);
  const [activeFiles, setActiveFiles] = useState([]);
  const [lockedFiles, setLockedFiles] = useState([]);
  const [hiddenFiles, setHiddenFiles] = useState([]);
  const [stats, setStats] = useState({ create: 0, delete: 0, rename: 0, restore: 0, modify: 0, alert: 0 });

  useEffect(() => {
    fetch('http://localhost:5000/api/data')
      .then((res) => res.json())
      .then((data) => {
        setLogs(data.logs || []);
        setDeletedFiles(data.deletedFiles || []);
        setActiveFiles(data.activeFiles || []);
        setLockedFiles(data.lockedFiles || []);
        setHiddenFiles(data.hiddenFiles || []);
        calculateStats(data.logs || []);
      })
      .catch((err) => console.error("System Core Connect Error:", err));

    socket.on('new-log', (newLog) => {
      setLogs((prev) => {
        const updated = [newLog, ...prev];
        calculateStats(updated);
        return updated;
      });
      refreshFileList();
    });

    socket.on('deleted-list-update', (updatedList) => setDeletedFiles(updatedList || []));
    socket.on('lock-status-update', (updatedLocks) => setLockedFiles(updatedLocks || []));
    socket.on('hidden-status-update', (updatedHides) => setHiddenFiles(updatedHides || []));

    return () => {
      socket.off('new-log');
      socket.off('deleted-list-update');
      socket.off('lock-status-update');
      socket.off('hidden-status-update');
    };
  }, []);

  const refreshFileList = () => {
    fetch('http://localhost:5000/api/data')
      .then((res) => res.json())
      .then((data) => {
        setActiveFiles(data.activeFiles || []);
        setHiddenFiles(data.hiddenFiles || []);
      });
  };

  const calculateStats = (allLogs) => {
    const counts = { create: 0, delete: 0, rename: 0, restore: 0, modify: 0, alert: 0 };
    allLogs.forEach(log => {
      if (log.action === 'CREATE') counts.create++;
      if (log.action === 'DELETE') counts.delete++;
      if (log.action === 'RENAME') counts.rename++;
      if (log.action === 'RESTORE') counts.restore++;
      if (log.action === 'MODIFY') counts.modify++;
      if (log.action === 'SECURITY_ALERT') counts.alert++;
    });
    setStats(counts);
  };
  const toggleLock = async (fileName) => {
    await fetch('http://localhost:5000/api/toggle-lock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName }),
    });
  };

  const toggleVisibility = async (fileName) => {
    await fetch('http://localhost:5000/api/toggle-visibility', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName }),
    });
    refreshFileList();
  };

  const handleRestore = async (id) => {
    if (!id) return;
    await fetch('http://localhost:5000/api/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
  };

  const theme = {
    bg: '#050706',
    text: '#39ff14',
    border: '#39ff14',
    panelBg: '#0b110e',
    alert: '#ff003c',
    amber: '#ffb700',
    blue: '#00d2ff'
  };

  return (
    <div style={{ fontFamily: '"Courier New", monospace', backgroundColor: theme.bg, minHeight: '100vh', color: theme.text, padding: '20px' }}>
      
      <header style={{ borderBottom: `2px dashed ${theme.border}`, paddingBottom: '15px', marginBottom: '25px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: 0, textShadow: '0 0 12px #39ff14' }}>⚡ CYBER_SHIELD v2.5 // CORE_PANEL</h1>
          <span style={{ fontSize: '11px', color: '#666' }}>ANTI-TAMPERS INTERACTION ENGINES ONLINE // SECURITY MUTE DISABLED</span>
        </div>
        <div style={{ border: `1px solid ${theme.border}`, padding: '6px 15px', background: theme.panelBg, boxShadow: '0 0 8px #39ff14' }}>
          SECURE_STREAM: <b style={{ color: '#fff' }}>my-monitor-folder</b>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '15px', marginBottom: '25px' }}>
        <div style={{ border: `1px solid ${theme.border}`, padding: '15px', background: theme.panelBg }}>
          <div style={{ fontSize: '11px', color: '#666' }}>SYS.CREATED</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', marginTop: '5px' }}>{stats.create}</div>
        </div>
        <div style={{ border: `1px solid ${theme.border}`, padding: '15px', background: theme.panelBg, color: theme.blue }}>
          <div style={{ fontSize: '11px', color: '#666' }}>SYS.MODIFIED</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', marginTop: '5px' }}>{stats.modify}</div>
        </div>
        <div style={{ border: `1px solid ${theme.border}`, padding: '15px', background: theme.panelBg, color: theme.amber }}>
          <div style={{ fontSize: '11px', color: '#666' }}>SYS.RENAMED</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', marginTop: '5px' }}>{stats.rename}</div>
        </div>
        <div style={{ border: `1px solid ${theme.border}`, padding: '15px', background: theme.panelBg, color: theme.alert }}>
          <div style={{ fontSize: '11px', color: '#666' }}>SYS.DELETED</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', marginTop: '5px' }}>{stats.delete}</div>
        </div>
        <div style={{ border: `1px solid ${theme.alert}`, padding: '15px', background: '#1c0307', color: theme.alert, boxShadow: stats.alert > 0 ? '0 0 15px #ff003c' : 'none' }}>
          <div style={{ fontSize: '11px', color: '#faa' }}>INTRUSION.ALERTS</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', marginTop: '5px' }}>{stats.alert}</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 0.9fr', gap: '20px' }}>
        
        {/* Panel 1: Security Controls */}
        <div style={{ border: `1px solid ${theme.border}`, padding: '20px', background: theme.panelBg }}>
          <h2 style={{ fontSize: '15px', borderBottom: `1px solid ${theme.border}`, paddingBottom: '10px', marginTop: 0 }}> [NODE_CONTROL_ROOM]</h2>
          <div style={{ maxHeight: '450px', overflowY: 'auto' }}>
            {activeFiles.length === 0 ? <p style={{ color: '#444' }}>&gt; NO_DATA_TARGETS_LOADED</p> : 
              activeFiles.map(file => {
                const isLocked = lockedFiles.includes(file);
                const isHidden = hiddenFiles.includes(file);
                return (
                  <div key={file} style={{ border: `1px solid ${isLocked ? theme.alert : '#182c18'}`, padding: '10px', marginBottom: '8px', background: '#020503', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span style={{ fontWeight: 'bold', color: isLocked ? theme.alert : theme.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      &gt; {file} {isLocked && '[OS_LOCKED]'} {isHidden && '[STEALTH]'}
                    </span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => toggleLock(file)} style={{ flex: 1, background: isLocked ? theme.alert : 'transparent', color: isLocked ? '#000' : theme.text, border: `1px solid ${theme.border}`, padding: '5px', cursor: 'pointer', fontFamily: 'monospace', fontSize: '11px', fontWeight: 'bold' }}>
                        {isLocked ? '🔓 UNLOCK' : '🔒 DEEP_LOCK'}
                      </button>
                      <button onClick={() => toggleVisibility(file)} style={{ flex: 1, background: isHidden ? theme.amber : 'transparent', color: isHidden ? '#000' : theme.amber, border: `1px solid ${theme.amber}`, padding: '5px', cursor: 'pointer', fontFamily: 'monospace', fontSize: '11px', fontWeight: 'bold' }}>
                        {isHidden ? '👁️ BLINK_ON' : '👻 CLOAK_HIDE'}
                      </button>
                    </div>
                  </div>
                );
              })
            }
          </div>
        </div>

        {/* Panel 2: Live Activity Terminals */}
        <div style={{ border: `1px solid ${theme.border}`, padding: '20px', background: theme.panelBg }}>
          <h2 style={{ fontSize: '15px', borderBottom: `1px solid ${theme.border}`, paddingBottom: '10px', marginTop: 0 }}> [INTRUSION_LOGS_STREAM]</h2>
          <div style={{ maxHeight: '450px', overflowY: 'auto', fontSize: '12px' }}>
            {logs.length === 0 ? <p style={{ color: '#444' }}>&gt; IDLE_LISTENING_MODE...</p> :
              logs.map((log) => {
                const isAlert = log.action === 'SECURITY_ALERT';
                return (
                  <div key={log.id || Math.random()} style={{ padding: '8px', borderBottom: '1px dashed #142414', color: isAlert ? theme.alert : theme.text }}>
                    <div>[{log.time}] -- <b style={{ textShadow: isAlert ? '0 0 5px #ff003c' : 'none' }}>{log.action}</b></div>
                    <div style={{ marginTop: '2px', color: isAlert ? '#ffa3a3' : '#fff' }}>{log.message}</div>
                    {log.details && <div style={{ fontSize: '10px', color: '#888', background: '#000', padding: '4px', marginTop: '3px', wordBreak: 'break-all', border: '1px solid #142414' }}>{log.details}</div>}
                  </div>
                );
              })
            }
          </div>
        </div>

        {/* Panel 3: Recovery Vault */}
        <div style={{ border: `1px solid ${theme.border}`, padding: '20px', background: theme.panelBg }}>
          <h2 style={{ fontSize: '15px', borderBottom: `1px solid ${theme.border}`, paddingBottom: '10px', marginTop: 0 }}> [QUANTUM_RECOVERY_VAULT]</h2>
          <div style={{ maxHeight: '450px', overflowY: 'auto' }}>
            {deletedFiles.length === 0 ? <p style={{ color: '#444' }}>&gt; SECURE_SECTOR_CLEAN</p> : 
              deletedFiles.map((file) => (
                <div key={file.id} style={{ border: '1px solid #182c18', padding: '10px', marginBottom: '8px', background: '#000', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ maxWidth: '60%' }}>
                    <div style={{ fontWeight: 'bold', color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.originalName}</div>
                    <span style={{ fontSize: '10px', color: '#555' }}>Wiped: {file.deletedAt}</span>
                  </div>
                  <button onClick={() => handleRestore(file.id)} style={{ background: theme.text, color: '#000', border: 'none', padding: '6px 12px', cursor: 'pointer', fontFamily: 'monospace', fontWeight: 'bold', fontSize: '11px' }}>
                    RECOVER
                  </button>
                </div>
              ))
            }
          </div>
        </div>

      </div>
    </div>
  );
}

export default App;
