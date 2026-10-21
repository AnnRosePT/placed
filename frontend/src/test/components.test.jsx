import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { MetricCard, StatusChip } from "../components/ui/index.jsx";

vi.mock("../services/studentsService.js", () => ({
  studentsService: { create: vi.fn(), update: vi.fn() },
}));

const authState = { session: null, profile: null, loading: false };
vi.mock("../context/AuthContext.jsx", () => ({ useAuth: () => authState }));

describe("MetricCard", () => {
  it("renders label, value, unit and trend", () => {
    render(<MetricCard label="Students placed" value={42} unit="/ 50" trend="84% of cohort" icon="verified" />);
    expect(screen.getByText("Students placed")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("/ 50")).toBeInTheDocument();
    expect(screen.getByText("84% of cohort")).toBeInTheDocument();
  });
  it("shows a dash when the value is missing", () => {
    render(<MetricCard label="Rate" value={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("StatusChip", () => {
  it.each([["placed", "Placed"], ["in_process", "In Process"], ["not_placed", "Not Placed"], ["opted_out", "Opted Out"]])("labels %s", (status, label) => {
    render(<StatusChip status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe("StudentFormModal validation", () => {
  it("blocks submit and shows field errors for invalid input", async () => {
    const { StudentFormModal } = await import("../pages/StudentModals.jsx");
    const { studentsService } = await import("../services/studentsService.js");
    render(<MemoryRouter><StudentFormModal open student={null} onClose={() => {}} onSaved={() => {}} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("CGPA"), { target: { value: "12" } });
    fireEvent.submit(screen.getByRole("button", { name: /save record/i }).closest("form"));
    await waitFor(() => expect(screen.getByText("USN is required.")).toBeInTheDocument());
    expect(screen.getByText("Full name is required.")).toBeInTheDocument();
    expect(screen.getByText(/between 0 and 10/)).toBeInTheDocument();
    expect(studentsService.create).not.toHaveBeenCalled();
  });
});

describe("ProtectedRoute", () => {
  const renderAt = async (allowedRoles) => {
    const { default: ProtectedRoute } = await import("../routes/ProtectedRoute.jsx");
    return render(<MemoryRouter initialEntries={["/admin"]}><Routes>
      <Route path="/login" element={<p>login page</p>} />
      <Route path="/" element={<p>home page</p>} />
      <Route element={<ProtectedRoute allowedRoles={allowedRoles} />}><Route path="/admin" element={<p>admin page</p>} /></Route>
    </Routes></MemoryRouter>);
  };
  it("redirects anonymous users to login", async () => {
    Object.assign(authState, { session: null, profile: null });
    await renderAt(["super_admin"]);
    expect(screen.getByText("login page")).toBeInTheDocument();
  });
  it("redirects users without the role to home", async () => {
    Object.assign(authState, { session: { access_token: "x" }, profile: { role: "faculty_mentor" } });
    await renderAt(["super_admin"]);
    expect(screen.getByText("home page")).toBeInTheDocument();
  });
  it("renders the page for an allowed role", async () => {
    Object.assign(authState, { session: { access_token: "x" }, profile: { role: "super_admin" } });
    await renderAt(["super_admin"]);
    expect(screen.getByText("admin page")).toBeInTheDocument();
  });
});
