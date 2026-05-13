import { useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import ChatPage from "./pages/ChatPage.jsx";
import SourcesPage from "./pages/SourcesPage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import { getApiKey, setApiKey, clearApiKey } from "./lib/api.js";

export default function App() {
  const [authed, setAuthed] = useState(() => !!getApiKey());

  if (!authed) {
    return (
      <LoginPage
        onLogin={(key) => {
          setApiKey(key);
          setAuthed(true);
        }}
      />
    );
  }

  return (
    <Layout onLogout={() => { clearApiKey(); setAuthed(false); }}>
      <Routes>
        <Route path="/" element={<ChatPage />} />
        <Route path="/sources" element={<SourcesPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
