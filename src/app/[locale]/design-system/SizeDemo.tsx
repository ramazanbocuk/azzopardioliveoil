"use client";

import { useState } from "react";
import { SizeSelector } from "@/components/ui/Field";

export function SizeDemo() {
  const [value, setValue] = useState("750");
  return (
    <SizeSelector
      legend="Size"
      value={value}
      onChange={setValue}
      options={[
        { value: "500", label: "500 ml" },
        { value: "750", label: "750 ml" },
        { value: "1000", label: "1000 ml" },
        { value: "3000", label: "3 L", disabled: true },
      ]}
    />
  );
}
