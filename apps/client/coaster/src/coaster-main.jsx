import React from "react";
import { createRoot } from "react-dom/client";

import "../../../../packages/coaster/styles.css";
import "./lobby.css";
import { createNet } from "./net.ts";
import OnlineApp from "./OnlineApp.jsx";

const net = createNet();

createRoot(document.getElementById("root")).render(<OnlineApp net={net} />);
