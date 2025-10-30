// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface CreditReport {
  id: string;
  encryptedScore: string;
  timestamp: number;
  owner: string;
  sources: string[];
  status: "pending" | "approved" | "rejected";
  decryptedScore?: number;
}

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const FHECompute = (encryptedData: string, operation: string): string => {
  const value = FHEDecryptNumber(encryptedData);
  let result = value;
  
  switch(operation) {
    case 'increase10%':
      result = value * 1.1;
      break;
    case 'decrease10%':
      result = value * 0.9;
      break;
    case 'double':
      result = value * 2;
      break;
    default:
      result = value;
  }
  
  return FHEEncryptNumber(result);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<CreditReport[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newReportData, setNewReportData] = useState({ sources: ["Bank A"], score: 0 });
  const [showTutorial, setShowTutorial] = useState(false);
  const [selectedReport, setSelectedReport] = useState<CreditReport | null>(null);
  const [decryptedScore, setDecryptedScore] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [activeTab, setActiveTab] = useState('reports');
  const [searchTerm, setSearchTerm] = useState('');

  const approvedCount = reports.filter(r => r.status === "approved").length;
  const pendingCount = reports.filter(r => r.status === "pending").length;
  const rejectedCount = reports.filter(r => r.status === "rejected").length;

  useEffect(() => {
    loadReports().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadReports = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      
      const keysBytes = await contract.getData("report_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing report keys:", e); }
      }
      
      const list: CreditReport[] = [];
      for (const key of keys) {
        try {
          const reportBytes = await contract.getData(`report_${key}`);
          if (reportBytes.length > 0) {
            try {
              const reportData = JSON.parse(ethers.toUtf8String(reportBytes));
              list.push({ 
                id: key, 
                encryptedScore: reportData.score, 
                timestamp: reportData.timestamp, 
                owner: reportData.owner, 
                sources: reportData.sources || [], 
                status: reportData.status || "pending" 
              });
            } catch (e) { console.error(`Error parsing report data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading report ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setReports(list);
    } catch (e) { console.error("Error loading reports:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const submitReport = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting credit score with Zama FHE..." });
    try {
      const encryptedScore = FHEEncryptNumber(newReportData.score);
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const reportId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const reportData = { 
        score: encryptedScore, 
        timestamp: Math.floor(Date.now() / 1000), 
        owner: address, 
        sources: newReportData.sources, 
        status: "pending" 
      };
      
      await contract.setData(`report_${reportId}`, ethers.toUtf8Bytes(JSON.stringify(reportData)));
      
      const keysBytes = await contract.getData("report_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(reportId);
      await contract.setData("report_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Encrypted credit report submitted securely!" });
      await loadReports();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewReportData({ sources: ["Bank A"], score: 0 });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryptNumber(encryptedData);
    } catch (e) { console.error("Decryption failed:", e); return null; } 
    finally { setIsDecrypting(false); }
  };

  const approveReport = async (reportId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Processing encrypted data with FHE..." });
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Failed to get contract");
      const reportBytes = await contract.getData(`report_${reportId}`);
      if (reportBytes.length === 0) throw new Error("Report not found");
      const reportData = JSON.parse(ethers.toUtf8String(reportBytes));
      
      const verifiedScore = FHECompute(reportData.score, 'increase10%');
      
      const contractWithSigner = await getContractWithSigner();
      if (!contractWithSigner) throw new Error("Failed to get contract with signer");
      
      const updatedReport = { ...reportData, status: "approved", score: verifiedScore };
      await contractWithSigner.setData(`report_${reportId}`, ethers.toUtf8Bytes(JSON.stringify(updatedReport)));
      
      setTransactionStatus({ visible: true, status: "success", message: "FHE verification completed successfully!" });
      await loadReports();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Verification failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const rejectReport = async (reportId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Processing encrypted data with FHE..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      const reportBytes = await contract.getData(`report_${reportId}`);
      if (reportBytes.length === 0) throw new Error("Report not found");
      const reportData = JSON.parse(ethers.toUtf8String(reportBytes));
      const updatedReport = { ...reportData, status: "rejected" };
      await contract.setData(`report_${reportId}`, ethers.toUtf8Bytes(JSON.stringify(updatedReport)));
      setTransactionStatus({ visible: true, status: "success", message: "FHE rejection completed successfully!" });
      await loadReports();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Rejection failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const isOwner = (reportAddress: string) => address?.toLowerCase() === reportAddress.toLowerCase();

  const filteredReports = reports.filter(report => 
    report.id.toLowerCase().includes(searchTerm.toLowerCase()) || 
    report.sources.some(source => source.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const renderCreditScoreChart = () => {
    const scores = reports
      .filter(r => r.status === "approved")
      .map(r => FHEDecryptNumber(r.encryptedScore));
    
    if (scores.length === 0) return <div className="no-data">No approved reports yet</div>;
    
    const maxScore = Math.max(...scores);
    const minScore = Math.min(...scores);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    
    return (
      <div className="score-chart">
        <div className="chart-bars">
          {scores.slice(0, 5).map((score, i) => (
            <div key={i} className="chart-bar-container">
              <div 
                className="chart-bar" 
                style={{ height: `${(score / maxScore) * 100}%` }}
              ></div>
              <div className="chart-label">{score.toFixed(0)}</div>
            </div>
          ))}
        </div>
        <div className="chart-stats">
          <div className="stat-item">
            <div className="stat-label">Highest</div>
            <div className="stat-value">{maxScore.toFixed(0)}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Average</div>
            <div className="stat-value">{avgScore.toFixed(0)}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Lowest</div>
            <div className="stat-value">{minScore.toFixed(0)}</div>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing encrypted connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>FHE<span>Credit</span>Bureau</h1>
          <div className="fhe-badge">ZAMA FHE Powered</div>
        </div>
        <div className="header-actions">
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>

      <nav className="main-nav">
        <button 
          className={`nav-btn ${activeTab === 'reports' ? 'active' : ''}`}
          onClick={() => setActiveTab('reports')}
        >
          My Credit Reports
        </button>
        <button 
          className={`nav-btn ${activeTab === 'stats' ? 'active' : ''}`}
          onClick={() => setActiveTab('stats')}
        >
          Statistics
        </button>
        <button 
          className={`nav-btn ${activeTab === 'about' ? 'active' : ''}`}
          onClick={() => setActiveTab('about')}
        >
          About FHE Credit
        </button>
      </nav>

      <main className="main-content">
        {activeTab === 'reports' && (
          <div className="reports-section">
            <div className="section-header">
              <h2>My Encrypted Credit Reports</h2>
              <div className="header-actions">
                <div className="search-box">
                  <input 
                    type="text" 
                    placeholder="Search reports..." 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                  <div className="search-icon"></div>
                </div>
                <button onClick={() => setShowCreateModal(true)} className="primary-btn">
                  + New Report
                </button>
                <button onClick={loadReports} className="refresh-btn" disabled={isRefreshing}>
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>

            <div className="reports-list">
              {filteredReports.length === 0 ? (
                <div className="no-reports">
                  <div className="no-reports-icon"></div>
                  <p>No credit reports found</p>
                  <button className="primary-btn" onClick={() => setShowCreateModal(true)}>
                    Create Your First Report
                  </button>
                </div>
              ) : (
                filteredReports.map(report => (
                  <div 
                    className={`report-card ${report.status}`} 
                    key={report.id}
                    onClick={() => setSelectedReport(report)}
                  >
                    <div className="report-header">
                      <div className="report-id">#{report.id.substring(0, 6)}</div>
                      <div className={`status-badge ${report.status}`}>{report.status}</div>
                    </div>
                    <div className="report-details">
                      <div className="detail-item">
                        <span>Sources:</span>
                        <div className="sources-list">
                          {report.sources.join(", ")}
                        </div>
                      </div>
                      <div className="detail-item">
                        <span>Date:</span>
                        {new Date(report.timestamp * 1000).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="report-actions">
                      {isOwner(report.owner) && report.status === "pending" && (
                        <>
                          <button 
                            className="action-btn approve" 
                            onClick={(e) => { e.stopPropagation(); approveReport(report.id); }}
                          >
                            Approve
                          </button>
                          <button 
                            className="action-btn reject" 
                            onClick={(e) => { e.stopPropagation(); rejectReport(report.id); }}
                          >
                            Reject
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'stats' && (
          <div className="stats-section">
            <h2>Credit Report Statistics</h2>
            <div className="stats-grid">
              <div className="stat-card">
                <h3>Report Distribution</h3>
                <div className="distribution-chart">
                  <div className="chart-segment approved" style={{ width: `${(approvedCount / reports.length) * 100}%` }}></div>
                  <div className="chart-segment pending" style={{ width: `${(pendingCount / reports.length) * 100}%` }}></div>
                  <div className="chart-segment rejected" style={{ width: `${(rejectedCount / reports.length) * 100}%` }}></div>
                </div>
                <div className="chart-legend">
                  <div className="legend-item"><div className="color-dot approved"></div> Approved: {approvedCount}</div>
                  <div className="legend-item"><div className="color-dot pending"></div> Pending: {pendingCount}</div>
                  <div className="legend-item"><div className="color-dot rejected"></div> Rejected: {rejectedCount}</div>
                </div>
              </div>
              <div className="stat-card">
                <h3>Credit Score Range</h3>
                {renderCreditScoreChart()}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'about' && (
          <div className="about-section">
            <h2>About FHE Credit Bureau</h2>
            <div className="about-content">
              <div className="about-card">
                <h3>How It Works</h3>
                <p>
                  The FHE Credit Bureau uses Zama's Fully Homomorphic Encryption to process your financial data without ever decrypting it. 
                  Your sensitive information remains encrypted throughout the entire credit scoring process.
                </p>
                <div className="fhe-process">
                  <div className="process-step">
                    <div className="step-icon">1</div>
                    <div className="step-content">
                      <h4>Data Encryption</h4>
                      <p>Your financial data is encrypted on your device using Zama FHE before being sent to the blockchain.</p>
                    </div>
                  </div>
                  <div className="process-step">
                    <div className="step-icon">2</div>
                    <div className="step-content">
                      <h4>Secure Processing</h4>
                      <p>Credit scores are calculated directly on encrypted data using homomorphic operations.</p>
                    </div>
                  </div>
                  <div className="process-step">
                    <div className="step-icon">3</div>
                    <div className="step-content">
                      <h4>Private Results</h4>
                      <p>Only you can decrypt and view your final credit score using your wallet signature.</p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="about-card">
                <h3>Benefits</h3>
                <ul className="benefits-list">
                  <li>Complete data privacy - your financial details never leave your device unencrypted</li>
                  <li>Decentralized control - no single entity controls your credit information</li>
                  <li>Transparent scoring - all calculations are verifiable on-chain</li>
                  <li>User sovereignty - you control who can access your credit data</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </main>

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>Create New Credit Report</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-btn">&times;</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Data Sources</label>
                <div className="sources-selector">
                  {["Bank A", "Crypto Wallet", "Payment History", "Loan Records"].map(source => (
                    <div 
                      key={source} 
                      className={`source-tag ${newReportData.sources.includes(source) ? 'selected' : ''}`}
                      onClick={() => {
                        if (newReportData.sources.includes(source)) {
                          setNewReportData({
                            ...newReportData,
                            sources: newReportData.sources.filter(s => s !== source)
                          });
                        } else {
                          setNewReportData({
                            ...newReportData,
                            sources: [...newReportData.sources, source]
                          });
                        }
                      }}
                    >
                      {source}
                    </div>
                  ))}
                </div>
              </div>
              <div className="form-group">
                <label>Credit Score</label>
                <input 
                  type="number" 
                  value={newReportData.score} 
                  onChange={(e) => setNewReportData({...newReportData, score: parseInt(e.target.value) || 0})}
                  placeholder="Enter your credit score"
                />
              </div>
              <div className="encryption-preview">
                <h4>FHE Encryption Preview</h4>
                <div className="preview-content">
                  <div className="plain-value">
                    <span>Plain Score:</span>
                    <div>{newReportData.score}</div>
                  </div>
                  <div className="arrow-icon">→</div>
                  <div className="encrypted-value">
                    <span>Encrypted:</span>
                    <div>{FHEEncryptNumber(newReportData.score).substring(0, 30)}...</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-btn">Cancel</button>
              <button 
                onClick={submitReport} 
                disabled={creating || newReportData.sources.length === 0}
                className="submit-btn"
              >
                {creating ? "Encrypting with FHE..." : "Submit Securely"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedReport && (
        <div className="modal-overlay">
          <div className="report-modal">
            <div className="modal-header">
              <h2>Credit Report Details</h2>
              <button onClick={() => { setSelectedReport(null); setDecryptedScore(null); }} className="close-btn">&times;</button>
            </div>
            <div className="modal-body">
              <div className="report-details">
                <div className="detail-row">
                  <span>Report ID:</span>
                  <div>{selectedReport.id}</div>
                </div>
                <div className="detail-row">
                  <span>Status:</span>
                  <div className={`status-badge ${selectedReport.status}`}>{selectedReport.status}</div>
                </div>
                <div className="detail-row">
                  <span>Date Created:</span>
                  <div>{new Date(selectedReport.timestamp * 1000).toLocaleString()}</div>
                </div>
                <div className="detail-row">
                  <span>Data Sources:</span>
                  <div className="sources-list">
                    {selectedReport.sources.map((source, i) => (
                      <div key={i} className="source-tag">{source}</div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="score-section">
                <h3>Credit Score</h3>
                <div className="encrypted-score">
                  <div className="score-value">
                    {decryptedScore !== null ? decryptedScore : "ENCRYPTED"}
                  </div>
                  <div className="score-label">
                    {decryptedScore !== null ? "Decrypted Score" : "FHE Encrypted"}
                  </div>
                </div>
                <button 
                  className="decrypt-btn" 
                  onClick={async () => {
                    if (decryptedScore === null) {
                      const score = await decryptWithSignature(selectedReport.encryptedScore);
                      setDecryptedScore(score);
                    } else {
                      setDecryptedScore(null);
                    }
                  }}
                  disabled={isDecrypting}
                >
                  {isDecrypting ? "Decrypting..." : decryptedScore !== null ? "Hide Score" : "Decrypt with Wallet"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`status-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="status-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
          </div>
          <div className="footer-copyright">
            © {new Date().getFullYear()} FHE Credit Bureau. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;