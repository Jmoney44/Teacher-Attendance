import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import QRScannerPage from './pages/QRScannerPage';
import AttendanceRecordsPage from './pages/AttendanceRecordsPage';
import CheckInPage from './pages/CheckInPage';

const App: React.FC = () => {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/teachers" element={<Navigate to="/dashboard" replace />} />
        <Route path="/scanner" element={<QRScannerPage />} />
        <Route path="/attendance" element={<AttendanceRecordsPage />} />
        <Route path="/check-in/:token" element={<CheckInPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Router>
  );
};

export default App;
