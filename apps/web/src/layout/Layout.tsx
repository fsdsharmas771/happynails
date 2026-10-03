import { Outlet } from "react-router";
import { BagDrawer } from "../cart/BagDrawer";
import { ScrollProgress, Spotlight, useMagneticButtons } from "./Effects";
import { Footer, MobileBar } from "./Footer";
import { Nav } from "./Nav";
import { Toast } from "./Toast";
import "./layout.css";
import "./overlays.css";

export function Layout() {
  useMagneticButtons();
  return (
    <>
      <Spotlight />
      <ScrollProgress />
      <Nav />
      <main className="wrap" id="top">
        <Outlet />
      </main>
      <Footer />
      <MobileBar />
      <BagDrawer />
      <Toast />
    </>
  );
}
