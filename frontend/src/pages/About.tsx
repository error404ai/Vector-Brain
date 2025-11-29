import { Link } from 'react-router-dom';

function About() {
  return (
    <div>
      <h1>About Vector Brain</h1>
      <div className="card">
        <p>This is a monorepo full-stack application.</p>
        <h3>Tech Stack:</h3>
        <ul style={{ textAlign: 'left', maxWidth: '400px', margin: '1rem auto' }}>
          <li>
            <strong>Backend:</strong> Express + TypeScript + TypeORM
          </li>
          <li>
            <strong>Frontend:</strong> React + Vite + TypeScript
          </li>
          <li>
            <strong>Database:</strong> MySQL
          </li>
          <li>
            <strong>DI:</strong> TypeDI
          </li>
        </ul>
      </div>
      <p className="read-the-docs">
        <Link to="/">← Back to Home</Link>
      </p>
    </div>
  );
}

export default About;
