import { Navigate } from 'react-router-dom';

const AttendanceRecordsPage: React.FC = () => {
  return <Navigate to="/dashboard#arrivals" replace />;
};

export default AttendanceRecordsPage;
