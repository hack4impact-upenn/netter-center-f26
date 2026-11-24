import { Routes, Route, Navigate } from "react-router-dom";

import Login from "./pages/Login";
import Notifications from "./pages/Notifications";
import { Shell } from "./components/layout/Shell";
import { useClearance } from "./state/clearance";
import Dashboard from "./pages/Dashboard";
import ReviewQueue from "./pages/ReviewQueue";
import Students from "./pages/Students";
import Roster from "./pages/Roster";
import Settings from "./pages/Settings";
import MyClass from "./pages/MyClass";

export default function App() {
  const { viewer } = useClearance();
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="*" element={<Navigate to="/" replace />} />
      <Route element={<Shell />}>
        {viewer.role === "admin" ? (
          <>
            <Route path="/" element={<Dashboard />} />
            <Route path="/review" element={<ReviewQueue />} />
            <Route path="/students" element={<Students />} />
            <Route path="/roster" element={<Roster />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        ) : (
          <>
            <Route path="/class/:courseId?" element={<MyClass />} />
            <Route path="*" element={<Navigate to="/class" replace />} />
          </>
        )}
      </Route>
    </Routes>
  );
}
