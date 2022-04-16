import React, { InputHTMLAttributes } from 'react';

import styles from './InputField.module.css';

interface IInputFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  className?: string;
}

/* eslint-disable react/jsx-props-no-spreading */
function InputField({ label, className, ...rest }: IInputFieldProps) {
  return (
    <div className={`${className || ''} ${styles.inputWrapper}`}>
      <h4>{label}</h4>
      <input {...rest} />
    </div>
  );
}

export default InputField;
