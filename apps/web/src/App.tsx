import { BrowserRouter, Route, Routes } from "react-router";
import { ThemeProvider } from "@happynails/ui";
import { HomePage } from "./home/HomePage";
import { Layout } from "./layout/Layout";
import { NotFound } from "./NotFound";

export function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
