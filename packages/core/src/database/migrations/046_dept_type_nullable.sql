-- Make department_type optional (API schema already marks it optional)
ALTER TABLE departments ALTER COLUMN department_type DROP NOT NULL;
