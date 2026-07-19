import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ConfigProvider } from "antd";
import Host from "./pages/Host";
import Viewer from "./pages/Viewer";

export default function App() {
  return (
    <ConfigProvider
      theme={{
        token: {
          fontFamily: '"Plus Jakarta Sans", sans-serif',
          colorPrimary: "#ff7a45", // Warm, cozy volcano orange
          borderRadius: 16, // Friendly rounded corners
          colorBgContainer: "rgba(255, 255, 255, 0.9)", // Translucent card background
        },
      }}
    >
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Host />} />
          <Route path="/room/:roomId" element={<Viewer />} />
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  );
}
