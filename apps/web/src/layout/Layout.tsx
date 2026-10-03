import { Outlet } from "react-router";
import { ScrollProgress, Spotlight, useMagneticButtons } from "./Effects";
import { Footer, MobileBar } from "./Footer";
import { Nav } from "./Nav";
import "./layout.css";

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
    </>
  );
}
