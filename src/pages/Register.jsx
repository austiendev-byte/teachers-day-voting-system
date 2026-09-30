import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { useToast } from "../components/Toast";
import AuthLayout, { PasswordInput } from "../components/AuthLayout";

// Registration uses an isolated, non-persistent Supabase client.
// This prevents creating a new student account from replacing the currently
// logged-in administrator session in the same browser.
const registrationStorage = {
  data: new Map(),
  getItem(key) {
    return this.data.get(key) ?? null;
  },
  setItem(key, value) {
    this.data.set(key, value);
  },
  removeItem(key) {
    this.data.delete(key);
  },
};

const registrationSupabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      storage: registrationStorage,
      detectSessionInUrl: false,
    },
  },
);

function Register() {
  const navigate = useNavigate();
  const toast = useToast();

  const [programs, setPrograms] = useState([]);

  const [name, setName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [schoolId, setSchoolId] = useState("");
  const [programId, setProgramId] = useState("");
  const [majorId, setMajorId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [loadingPrograms, setLoadingPrograms] = useState(true);
  const [registering, setRegistering] = useState(false);

  useEffect(() => {
    fetchPrograms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchPrograms() {
    setLoadingPrograms(true);

    const { data, error } = await supabase
      .from("programs")
      .select(
        `
        id,
        program_code,
        program_name,
        school_id,
        schools (
          id,
          school_code,
          school_name
        ),
        majors (
          id,
          major_code,
          major_name
        )
      `,
      )
      .order("program_name", { ascending: true });

    if (error) {
      console.error("Error loading programs:", error);
      toast.error(`Could not load programs.\n\n${error.message}`);
      setLoadingPrograms(false);
      return;
    }

    setPrograms(data || []);
    setLoadingPrograms(false);
  }

  // Step 1 of program selection: group programs by school so the
  // student picks their school first, then a short list of programs
  // that actually belong to it -- instead of scanning 22 codes at once.
  const schools = useMemo(() => {
    const bySchool = new Map();

    for (const program of programs) {
      const school = program.schools;
      if (!school) continue;

      if (!bySchool.has(school.id)) {
        bySchool.set(school.id, {
          id: school.id,
          school_code: school.school_code,
          school_name: school.school_name,
        });
      }
    }

    return Array.from(bySchool.values()).sort((a, b) =>
      a.school_name.localeCompare(b.school_name),
    );
  }, [programs]);

  const programsForSelectedSchool = useMemo(() => {
    if (!schoolId) return [];

    return programs
      .filter((program) => String(program.school_id) === String(schoolId))
      .sort((a, b) => a.program_name.localeCompare(b.program_name));
  }, [programs, schoolId]);

  function handleSchoolChange(event) {
    setSchoolId(event.target.value);
    setProgramId("");
    setMajorId("");
  }

  function handleProgramChange(event) {
    setProgramId(event.target.value);
    setMajorId("");
  }

  function getSelectedProgram() {
    return programs.find((program) => String(program.id) === String(programId));
  }

  // Any program with majors (BSED, BSBA, ...) requires the student to pick one.
  const majors = [...(getSelectedProgram()?.majors || [])].sort((a, b) =>
    a.major_name.localeCompare(b.major_name),
  );
  const programHasMajors = majors.length > 0;

  async function handleRegister(event) {
    event.preventDefault();

    if (!name.trim()) {
      toast.error("Please enter your full name.");
      return;
    }

    if (!studentId.trim()) {
      toast.error("Please enter your Student ID.");
      return;
    }

    if (!schoolId) {
      toast.error("Please select your school.");
      return;
    }

    if (!programId) {
      toast.error("Please select your program.");
      return;
    }

    if (!email.trim()) {
      toast.error("Please enter your email address.");
      return;
    }

    if (password.length < 6) {
      toast.error("Password must be at least 6 characters long.");
      return;
    }

    if (password !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }

    const selectedProgram = getSelectedProgram();

    if (!selectedProgram) {
      toast.error("Invalid program selection.");
      return;
    }

    if (programHasMajors && !majorId) {
      toast.error("Please select your major.");
      return;
    }

    setRegistering(true);

    try {
      const normalizedStudentId = studentId.trim();

      // --------------------------------------------------
      // STEP 1: Check the Student ID is not already taken.
      // --------------------------------------------------
      const { data: eligibility, error: eligibilityError } =
        await registrationSupabase.rpc("check_student_id_registration", {
          p_student_id: normalizedStudentId,
        });

      if (eligibilityError) {
        console.error("Student ID verification error:", eligibilityError);
        toast.error(
          `Could not verify your Student ID.\n\n${eligibilityError.message}`,
        );
        return;
      }

      const eligibilityResult = Array.isArray(eligibility)
        ? eligibility[0]
        : eligibility;

      if (eligibilityResult?.already_registered === true) {
        toast.error(
          "This Student ID already has an account.\n\nPlease use the login page or password recovery.",
        );
        return;
      }

      // --------------------------------------------------
      // STEP 2: Create the Supabase Auth account.
      // The database trigger reads these metadata values and
      // creates the student profile as APPROVED. Its unique
      // index is the real one-account-per-Student-ID guard, so
      // two simultaneous signups cannot create a duplicate.
      // --------------------------------------------------
      const { data: authData, error: authError } =
        await registrationSupabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              registration_type: "student",
              student_id: normalizedStudentId,
              name: name.trim(),
              program_id: Number(programId),
              major_id: majorId ? Number(majorId) : null,
            },
          },
        });

      if (authError) {
        console.error("Registration Auth error:", authError);

        const message = String(authError.message || "").toLowerCase();

        if (
          message.includes("already registered") ||
          message.includes("already exists")
        ) {
          toast.error(
            "That email already has an account. Please use another email or recover your password.",
          );
        } else if (
          message.includes("student id") &&
          message.includes("registered")
        ) {
          toast.error("This Student ID already has an account.");
        } else {
          toast.error(`Registration failed.\n\n${authError.message}`);
        }
        return;
      }

      if (!authData.user) {
        toast.error("Registration failed. No user account was created.");
        return;
      }

      toast.success(
        authData.session
          ? "Registration complete. Your account is approved and you can now log in."
          : "Registration complete. Your account is approved. Check your email if confirmation is required, then log in.",
      );

      navigate("/login", { replace: true });
    } catch (error) {
      console.error("Unexpected registration error:", error);
      toast.error(
        `An unexpected error occurred during registration.\n\n${error.message}`,
      );
    } finally {
      setRegistering(false);
    }
  }

  const passwordMismatch =
    confirmPassword.length > 0 && password !== confirmPassword;

  const sectionsDone = [
    Boolean(name.trim() && studentId.trim()),
    Boolean(
      schoolId &&
        programId &&
        (!programHasMajors || majorId),
    ),
    Boolean(email.trim() && password.length >= 6 && password === confirmPassword),
  ];

  return (
    <AuthLayout
      backTo="/login"
      wide
      tagline="Create your student account to take part in this year’s Teachers’ Day election."
      points={[
        "Takes less than two minutes",
        "Each Student ID can register only one account",
        "One account, one ballot, per student",
      ]}
      title="Create your account"
      subtitle="Student registration"
    >
      <div className="auth-steps" aria-hidden="true">
        {sectionsDone.map((done, index) => (
          <span key={index} className={done ? "is-done" : ""} />
        ))}
      </div>

      <form onSubmit={handleRegister} className="auth-form" noValidate>
        <fieldset className="auth-fieldset" disabled={registering}>
          <legend>About you</legend>

          <div className="field">
            <label className="label" htmlFor="name">
              Full name
            </label>
            <input
              className="input"
              id="name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Juan Dela Cruz"
              required
            />
          </div>

          <div className="field">
            <label className="label" htmlFor="studentId">
              Student ID
            </label>
            <input
              className="input num"
              id="studentId"
              type="text"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={studentId}
              onChange={(event) => setStudentId(event.target.value)}
              placeholder="2026-0001"
              required
            />
            <p className="help-text">
              One account per Student ID. Enter it exactly as it appears on your school ID.
            </p>
          </div>
        </fieldset>

        <fieldset className="auth-fieldset" disabled={registering}>
          <legend>Your school</legend>

          <div className="field">
            <label className="label" htmlFor="school">
              School
            </label>

            {loadingPrograms ? (
              <div className="skeleton input-skeleton" role="status" aria-label="Loading schools" />
            ) : (
              <select
                className="input"
                id="school"
                value={schoolId}
                onChange={handleSchoolChange}
                required
              >
                <option value="">Select your school</option>

                {schools.map((school) => (
                  <option key={school.id} value={school.id}>
                    {school.school_name}
                  </option>
                ))}
              </select>
            )}
            <p className="help-text">
              Choose your school first to see only its programs.
            </p>
          </div>

          {schoolId && (
            <div className="field field-reveal">
              <label className="label" htmlFor="program">
                Program
              </label>

              <select
                className="input"
                id="program"
                value={programId}
                onChange={handleProgramChange}
                required
              >
                <option value="">Select your program</option>

                {programsForSelectedSchool.map((program) => (
                  <option key={program.id} value={program.id}>
                    {program.program_name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {programHasMajors && (
            <div className="field field-reveal">
              <label className="label" htmlFor="major">
                Major
              </label>

              <select
                className="input"
                id="major"
                value={majorId}
                onChange={(event) => setMajorId(event.target.value)}
                required
              >
                <option value="">Select your major</option>

                {majors.map((major) => (
                  <option key={major.id} value={major.id}>
                    {major.major_name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </fieldset>

        <fieldset className="auth-fieldset" disabled={registering}>
          <legend>Sign-in details</legend>

          <div className="field">
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              className="input"
              id="email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              inputMode="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="student@example.com"
              required
            />
          </div>

          <div className="auth-grid-2">
            <div className="field">
              <label className="label" htmlFor="password">
                Password
              </label>
              <PasswordInput
                id="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={6}
                required
                aria-describedby="password-help"
              />
            </div>

            <div className="field">
              <label className="label" htmlFor="confirmPassword">
                Confirm password
              </label>
              <PasswordInput
                id="confirmPassword"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                minLength={6}
                required
                aria-invalid={passwordMismatch}
                aria-describedby="password-help"
              />
            </div>
          </div>

          <p
            id="password-help"
            className={`auth-password-help ${passwordMismatch ? "field-error" : "help-text"}`}
            role={passwordMismatch ? "alert" : undefined}
          >
            {passwordMismatch
              ? "Passwords do not match yet."
              : "At least 6 characters."}
          </p>
        </fieldset>

        <button
          type="submit"
          className="btn btn-primary btn-block"
          disabled={registering || loadingPrograms}
        >
          {registering && <span className="spinner" aria-hidden="true" />}
          {registering ? "Creating account" : "Create account"}
        </button>
      </form>

      <div className="auth-divider">Already registered?</div>

      <Link to="/login" className="btn btn-secondary btn-block">
        Log in instead
      </Link>
    </AuthLayout>
  );
}

export default Register;
