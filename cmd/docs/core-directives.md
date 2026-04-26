# CORE DIRECTIVES

This document complements the guidelines in CLAUDE.md and should be used in conjunction with it for optimal development practices in the low-code framework.

## DEVELOPMENT PRINCIPLES

### SOLUTION-FIRST APPROACH
- Focus on solving the specific business problem first, then consider implementation details
- Prioritize direct, actionable strategies that advance the implementation
- Eliminate unnecessary context that doesn't contribute to the solution

### EFFICIENCY OPTIMIZATION
- Focus development efforts on solution generation
- Minimize redundant code patterns and processes
- Optimize for the low-code framework's capabilities

## MULTI-DIMENSIONAL ANALYSIS FRAMEWORK

When encountering complex requirements in the low-code framework:

1. **Technical Observer**: Assess feasibility within current stack
2. **Architecture Observer**: Consider how the solution fits with the modular system
3. **Performance Observer**: Evaluate impact on Typesense search, Firebase sync, and UI responsiveness
4. **Integration Observer**: Plan for Firebase ↔ Typesense synchronization and UI component integration
5. **Synthesis**: Combine all observations into a unified implementation strategy aligned with the framework's architecture

## ADAPTIVE DEVELOPMENT MODES

### Context-Driven Behavior Switching

**EXPLORATION MODE** (for unclear or complex requirements)
- Analyze problem space using the multi-dimensional framework
- Clarify requirements with reference to existing patterns in the codebase
- Document architectural decisions
- Assess risks and mitigation strategies

**IMPLEMENTATION MODE** (for clearly defined tasks)
- Generate complete, working code following existing patterns
- Include comprehensive error handling and validation
- Consider performance implications from the start
- Plan integration and testing approaches

**DEBUGGING MODE** (for fixing issues)
- Systematically isolate failure points
- Perform root cause analysis with evidence
- Explore multiple solution paths with trade-off analysis
- Develop verification strategies for fixes

**OPTIMIZATION MODE** (for performance enhancement)
- Identify bottlenecks in Firebase queries, Typesense searches, or UI rendering
- Optimize resource utilization (database reads, memory, network requests)
- Consider scalability within the multi-tenant architecture
- Develop performance measurement strategies

## DEVELOPMENT OPTIMIZATION

### File Organization Strategy
- Follow the modular architecture (components and modules)
- Place scripts in appropriate directories (`scripts/`, `tests/`, `web-automation/`)
- Avoid creating temporary files in the root directory
- Use `docs/` for documentation of new modules/components

### Batching and Parallel Execution
Group operations by:
- **Dependency Chains**: Complete model changes before UI updates
- **Resource Types**: Batch database operations, API calls, UI rendering
- **Module Boundaries**: Group changes within the same module/component
- **Output Relationships**: Combine related changes that affect similar functionality

Execute operations simultaneously when they:
- Have no shared dependencies
- Operate on different resources or modules
- Can be safely parallelized without race conditions
- Benefit from concurrent execution

## DEVELOPMENT STANDARDS

When writing code, adhere to these principles:

### CODE QUALITY STANDARDS

- ✅ Prioritize simplicity and readability over clever solutions
- ✅ Start with minimal functionality and verify it works before adding complexity
- ✅ Test your code frequently with realistic inputs and validate outputs
- ✅ Create testing environments for components that are difficult to validate directly
- ✅ Use functional and stateless approaches where they improve clarity
- ✅ Keep core logic clean and push implementation details to the edges
- ✅ Balance file organization with simplicity - use an appropriate number of files for the project scale

### Success Indicators

- ✅ Complete, running code on first attempt in development
- ✅ Zero placeholder implementations in production code
- ✅ Minimal, efficient code following DRY principles
- ✅ Proactive handling of edge cases and error conditions
- ✅ Production-ready error handling and validation
- ✅ Comprehensive input validation and security checks

## TESTING & VALIDATION PROTOCOLS

### Automated Testing Requirements

- Unit tests for all business logic functions using Jest
- Integration tests for API endpoints
- E2E tests for critical user journeys using Playwright
- Performance tests for database queries and search operations

### Manual Validation Checklist

- Code compiles and runs without errors in development and production
- All edge cases handled appropriately (empty data, invalid inputs)
- Error messages are user-friendly and actionable
- Performance meets established benchmarks (page load, search response)
- Security considerations addressed (input validation, authentication checks)

## DEPLOYMENT & MAINTENANCE

### Pre-Deployment Verification

- All tests passing (unit, integration, E2E)
- Code follows established patterns and conventions
- Performance benchmarks met
- Security scan completed (no exposed secrets in code)
- Documentation updated for new features/modules

### Post-Deployment Monitoring

- Error rate monitoring for Node.js application
- Performance metric tracking (response times, Firebase sync speed)
- User feedback collection and analysis
- System health verification (Redis, Typesense connectivity)
- Firebase ↔ Typesense synchronization verification

## LOW-CODE FRAMEWORK OPTIMIZATION

### Component Reusability

- Design components for maximum reusability across modules
- Follow established patterns from existing components
- Document component usage in `docs/components/`
- Use the datagrid component for consistent data display

### Module Development

- Follow the existing module structure (like system, products, sales)
- Include proper model synchronization with Typesense
- Implement proper hooks for custom business logic
- Ensure multi-tenant compatibility

### Database Efficiency

- Optimize Firebase queries with proper indexing
- Efficiently handle Firebase ↔ Typesense synchronization
- Minimize database read operations
- Use caching appropriately (Redis) for frequently accessed data

## PROJECT-SPECIFIC PRACTICES

### File Organization

- Scripts go in `scripts/` (general), `scripts/tmp/` (temporary)
- Testing scripts in `tests/` or `web-automation/` (Playwright)
- Documentation in appropriate `docs/` subdirectories
- Temporary files never in project root

### Technology Stack Compliance

For specific coding conventions and technology stack requirements, refer to **CLAUDE.md**:

- **Code Format Standards**:
  - ES Modules (import/export), not require()
  - Async/await patterns over callbacks
  - Naming conventions: camelCase for variables, PascalCase for classes

- **Database Architecture**:
  - Firebase as source of truth
  - Typesense read-only for search (unidirectional sync)
  - Models manage synchronization automatically

This approach ensures single source of truth for technical standards while core-directives.md focuses on development philosophy and methodologies.