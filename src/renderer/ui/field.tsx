import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { forwardRef, type Ref } from "react";
import "./field.css";

type FieldInputProps = { as?: "input" } & InputHTMLAttributes<HTMLInputElement>;
type FieldTextareaProps = { as: "textarea" } & TextareaHTMLAttributes<HTMLTextAreaElement>;
type FieldSelectProps = { as: "select" } & SelectHTMLAttributes<HTMLSelectElement>;

export type FieldProps = FieldInputProps | FieldTextareaProps | FieldSelectProps;

export const Field = forwardRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, FieldProps>(
	function Field(props, ref) {
		const className = ["ui-field", props.className].filter(Boolean).join(" ");
		if (props.as === "textarea") {
			const { as: _as, className: _className, ...rest } = props;
			return <textarea ref={ref as Ref<HTMLTextAreaElement>} className={className} {...rest} />;
		}
		if (props.as === "select") {
			const { as: _as, className: _className, ...rest } = props;
			return <select ref={ref as Ref<HTMLSelectElement>} className={className} {...rest} />;
		}
		const { as: _as, className: _className, ...rest } = props;
		return <input ref={ref as Ref<HTMLInputElement>} className={className} {...rest} />;
	},
);
