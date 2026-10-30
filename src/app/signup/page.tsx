import { redirect } from "next/navigation";

// Company sign-up now lives with the other account types.
export default function SignupPage() {
  redirect("/join?as=company");
}
