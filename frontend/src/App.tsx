import ErrorModal from "@/components/ui/ErrorModal";
import { Router } from "./router";

function App() {
  return (
    <>
      <Router />
      <ErrorModal />
    </>
  );
}

export default App;
